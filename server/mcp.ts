/** Local MCP bridge: ChatGPT may propose edits; Vanta validates and executes them. */
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";
import { db, project, save, event, enqueue, busy } from "./db";
import { applyDecision, decisionSchema } from "./director";
import { wordSchema, remapCaptions } from "../src/agentic/contract";

const port = Number(process.env.MCP_PORT || 4318);
const token = process.env.MCP_SHARED_TOKEN;
const app = createMcpExpressApp({ host: "127.0.0.1" });
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host || ""))
    return res.sendStatus(403);
  if (req.headers.origin) return res.sendStatus(403);
  if (token && req.headers.authorization !== `Bearer ${token}`)
    return res.sendStatus(401);
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use((await import("express")).default.json({ limit: "2mb" }));

function server() {
  const mcp = new McpServer({ name: "vanta-agentic-editor", version: "0.1.0" });
  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const use = async (fn: () => unknown | Promise<unknown>) => {
    try {
      return result(await fn());
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: String((e as Error).message) }],
      };
    }
  };
  const projectId = z.string().regex(/^[a-f0-9]{32}$/);
  mcp.registerTool("list_projects", {
    description: "List local video projects and revisions.",
  }, async () => use(() => db.prepare("SELECT id,data,revision FROM projects").all().map((r: any) => ({ id: r.id, name: JSON.parse(r.data).name, revision: r.revision }))));

  mcp.registerTool("get_edit_context", {
    description: "Read current edit plan, speech and analysis for an existing project. Always read before proposing a revision. Media files remain local.",
    inputSchema: { projectId },
  }, async ({ projectId }) => use(() => {
    const p = project(projectId);
    return {
      id: p.id, name: p.name, revision: p.revision, primary: p.primary,
      assets: p.assets.map(({ path: _path, ...asset }: any) => asset),
      analysis: p.analysis ? {
        duration: p.analysis.duration,
        silences: p.analysis.silences,
        words: p.analysis.words,
        transcriptStatus: p.analysis.transcriptStatus,
        frames: p.analysis.frames?.map(({ time }: any) => ({ time })),
      } : null,
      plan: p.plan, history: p.history.slice(-15),
      renders: p.renders.map(({ path: _path, ...render }: any) => render),
      jobs: db.prepare("SELECT id,type,status,progress,error FROM jobs WHERE project=? ORDER BY created DESC LIMIT 10").all(p.id),
    };
  }));

  mcp.registerTool("view_sample_frames", {
    description: "Inspect up to eight cached frame samples from the video before making visual choices.",
    inputSchema: { projectId },
  }, async ({ projectId }) => {
    try {
      const frames = project(projectId).analysis?.frames?.slice(0, 8) || [];
      const images = await Promise.all(frames.map(async (f: any) => ({
        type: "image" as const,
        data: (await readFile(f.file)).toString("base64"),
        mimeType: "image/jpeg" as const,
      })));
      return { content: [
        { type: "text" as const, text: JSON.stringify({ timesSeconds: frames.map((f: any) => f.time) }) },
        ...images,
      ] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: String((e as Error).message) }] };
    }
  });

  mcp.registerTool("apply_edit_decision", {
    description: "Apply validated allowlisted operations to the existing timeline at a known revision. Invalid output never runs. Read project context first.",
    inputSchema: { projectId, revision: z.number().int().nonnegative(), instruction: z.string().min(1).max(8000), decision: decisionSchema },
  }, async ({ projectId, revision, instruction, decision }) => use(() => {
    const p = project(projectId);
    if (p.revision !== revision) throw Error("Revision conflict: reload project");
    if (busy(p.id) || !p.plan || !p.analysis) throw Error("Analyze first; project must be idle");
    const before = p.plan;
    const applied = applyDecision(before, decision, p.analysis, p.primary);
    p.plan = applied.plan;
    p.history.push({ role: "director", source: "chatgpt-interactive-mcp", instruction, text: applied.decision.summary, decision: applied.decision, at: Date.now() });
    const saved = save(p, revision);
    event(p.id, "chatgpt-proposal", { before, after: applied.plan, instruction, decision: applied.decision });
    return { id: p.id, revision: saved.revision, clips: saved.plan.clips.length, captions: saved.plan.captions.length, durationFrames: saved.plan.clips.reduce((n: number, c: any) => n + Math.round((c.outFrame - c.inFrame) / c.speed), 0) };
  }));

  mcp.registerTool("import_verified_transcript", {
    description: "Import word-level timestamps from an actual transcription of this source, then remap captions. Do not invent speech or times.",
    inputSchema: { projectId, revision: z.number().int().nonnegative(), words: z.array(wordSchema).max(100000) },
  }, async ({ projectId, revision, words }) => use(() => {
    const p = project(projectId);
    if (p.revision !== revision) throw Error("Revision conflict: reload project");
    if (busy(p.id) || !p.analysis || !p.plan) throw Error("Analyze first; project must be idle");
    const a = p.assets.find((a: any) => a.id === p.primary);
    if (words.some((w, i) => w.end > a.duration || (i && w.start < words[i - 1].start))) throw Error("Invalid transcript times");
    p.analysis.words = words;
    p.analysis.transcriptStatus = "imported";
    p.plan.captions = remapCaptions(p.plan, words, p.primary);
    const saved = save(p, revision);
    event(p.id, "transcript-import", { wordCount: words.length });
    return { revision: saved.revision, captions: saved.plan.captions.length };
  }));

  mcp.registerTool("queue_render", {
    description: "Queue an MP4 render of the validated current plan; poll job status. Rendering may take minutes.",
    inputSchema: { projectId, revision: z.number().int().nonnegative() },
  }, async ({ projectId, revision }) => use(() => {
    const p = project(projectId);
    if (p.revision !== revision) throw Error("Revision conflict: reload project");
    if (!p.plan || busy(p.id)) throw Error("Project requires an idle validated plan");
    return { jobId: enqueue(p.id, "render", { type: "render" }) };
  }));

  mcp.registerTool("get_render_status", {
    description: "Check render job and download path through the local editor UI.",
    inputSchema: { projectId, jobId: projectId },
  }, async ({ projectId, jobId }) => use(() => {
    project(projectId);
    const job = db.prepare("SELECT id,status,progress,error FROM jobs WHERE id=? AND project=?").get(jobId, projectId);
    if (!job) throw Error("Job not found");
    return {
      job,
      ...(job.status === "completed"
        ? { download: `http://127.0.0.1:${process.env.PORT || 4317}/api/projects/${projectId}/renders/${jobId}` }
        : {}),
    };
  }));
  return mcp;
}

app.post("/mcp", async (req, res) => {
  const mcp = server();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "MCP request failed" });
  } finally {
    await transport.close();
    await mcp.close();
  }
});
app.get("/mcp", (_req, res) => res.sendStatus(405));
app.delete("/mcp", (_req, res) => res.sendStatus(405));
app.listen(port, "127.0.0.1", () => console.log(`Vanta MCP: http://127.0.0.1:${port}/mcp`));

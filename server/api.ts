import express from "express";
import multer from "multer";
import path from "node:path";
import { mkdir, rename, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { db, dataRoot, uid, project, save, event, enqueue, busy } from "./db";
import { hash, inspect } from "./media";
import { applyDecision } from "./director";
import {
  validatePlan,
  wordSchema,
  remapCaptions,
} from "../src/agentic/contract";
const app = express(),
  port = Number(process.env.PORT || 4317),
  uploadDir = path.join(dataRoot, "uploads");
await mkdir(uploadDir, { recursive: true });
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = req.headers.host?.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host || ""))
    return res.status(403).json({ error: "Local single-user MVP only" });
  if (
    req.headers.origin &&
    !["http://localhost:" + port, "http://127.0.0.1:" + port].includes(
      req.headers.origin,
    )
  )
    return res.status(403).json({ error: "Cross-origin request rejected" });
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "8mb" }));
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    cb(
      null,
      [
        "video/mp4",
        "video/quicktime",
        "video/webm",
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",
        "audio/ogg",
        "image/png",
        "image/jpeg",
      ].includes(file.mimetype),
    ),
});
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
app.get("/api/config", (_req, res) =>
  res.json({
    providers: {
      openai: !!(
        process.env.OPENAI_API_KEY && process.env.OPENAI_DIRECTOR_MODEL
      ),
      anthropic: !!(
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_DIRECTOR_MODEL
      ),
    },
    transcription: !!process.env.OPENAI_API_KEY || !!(process.env.WHISPER_CPP_BIN && process.env.WHISPER_CPP_MODEL),
    mode: "local",
    limits: { maxMinutes: 60, maxMegabytes: 500 },
  }),
);
app.get("/api/projects", (_req, res) =>
  res.json(
    db
      .prepare("SELECT id,data,revision FROM projects")
      .all()
      .map((r: any) => {
        const p = JSON.parse(r.data);
        return { id: p.id, name: p.name, revision: r.revision };
      }),
  ),
);
app.post(
  "/api/projects",
  upload.single("file"),
  wrap(async (req: any, res: any) => {
    if (!req.file) throw Error("Supported video required");
    try {
      const info = await inspect(req.file.path);
      if (!info.video || info.image)
        throw Error("Primary source must be video");
      const id = uid(),
        assetId = uid(),
        digest = await hash(req.file.path),
        dest = path.join(uploadDir, assetId);
      await rename(req.file.path, dest);
      const asset = {
        ...info,
        id: assetId,
        hash: digest,
        path: dest,
        kind: "video",
        mime: info.mime,
        name: path.basename(req.file.originalname).slice(0, 200),
      };
      const p = {
        id,
        name: asset.name,
        primary: assetId,
        assets: [asset],
        analysis: null,
        plan: null,
        history: [],
        renders: [],
      };
      db.prepare("INSERT INTO projects(id,data) VALUES(?,?)").run(
        id,
        JSON.stringify(p),
      );
      event(id, "import", { asset: assetId });
      res.status(201).json(project(id));
    } catch (e) {
      await unlink(req.file.path).catch(() => {});
      throw e;
    }
  }),
);
app.get(
  "/api/projects/:id",
  wrap((req: any, res: any) => {
    const p = project(req.params.id);
    res.json({
      ...p,
      assets: p.assets.map(({ path, ...a }: any) => a),
      jobs: db
        .prepare(
          "SELECT * FROM jobs WHERE project=? ORDER BY created DESC LIMIT 20",
        )
        .all(p.id),
    });
  }),
);
app.get(
  "/api/projects/:id/events",
  wrap((req: any, res: any) =>
    res.json(
      db
        .prepare("SELECT * FROM events WHERE project=? ORDER BY created")
        .all(project(req.params.id).id),
    ),
  ),
);
app.post(
  "/api/projects/:id/assets",
  upload.single("file"),
  wrap(async (req: any, res: any) => {
    const p = project(req.params.id);
    if (!req.file) throw Error("Supported media required");
    try {
      if (busy(p.id)) throw Error("Project is processing");
      const info = await inspect(req.file.path),
        id = uid(),
        digest = await hash(req.file.path),
        dest = path.join(uploadDir, id);
      await rename(req.file.path, dest);
      p.assets.push({
        ...info,
        id,
        hash: digest,
        path: dest,
        kind: info.image ? "image" : info.video ? "video" : "audio",
        mime: info.mime,
        name: path.basename(req.file.originalname),
      });
      if (p.plan)
        p.plan.sources = p.assets.map((a: any) => ({
          id: a.id,
          kind: a.kind,
          durationSeconds: a.duration,
        }));
      res.json(save(p, p.revision));
    } catch (e) {
      await unlink(req.file.path).catch(() => {});
      throw e;
    }
  }),
);
app.get(
  "/api/projects/:id/assets/:asset",
  wrap((req: any, res: any) => {
    const a = project(req.params.id).assets.find(
      (a: any) => a.id === req.params.asset,
    );
    if (!a) return res.sendStatus(404);
    res.type(a.mime);
    res.sendFile(a.path);
  }),
);
app.get(
  "/api/projects/:id/proxy",
  wrap((req: any, res: any) => {
    const p = project(req.params.id),
      a = p.assets.find((a: any) => a.id === p.primary);
    res.sendFile(path.join(dataRoot, "cache", a.hash, "proxy.mp4"));
  }),
);
app.put(
  "/api/projects/:id/plan",
  wrap((req: any, res: any) => {
    const p = project(req.params.id);
    if (busy(p.id)) throw Error("Project is processing");
    const expected = z.number().int().parse(req.body.revision),
      plan = validatePlan(req.body.plan, p.plan.sources);
    const before = p.plan;
    p.plan = plan;
    const saved = save(p, expected);
    event(p.id, "human-edit", { before, after: plan });
    res.json(saved);
  }),
);
app.post(
  "/api/projects/:id/decisions",
  wrap((req: any, res: any) => {
    const p = project(req.params.id);
    if (busy(p.id) || !p.plan || !p.analysis)
      throw Error("Analyze first; project must be idle");
    const request = z
      .object({
        revision: z.number().int().nonnegative(),
        instruction: z.string().min(1).max(8000),
        decision: z.unknown(),
      })
      .strict()
      .parse(req.body);
    if (request.revision !== p.revision)
      throw Error("Revision conflict: reload project");
    const before = p.plan;
    const { plan, decision } = applyDecision(
      before,
      request.decision,
      p.analysis,
      p.primary,
    );
    p.plan = plan;
    p.history.push({
      role: "director",
      source: "chatgpt-interactive",
      instruction: request.instruction,
      text: decision.summary,
      decision,
      at: Date.now(),
    });
    const saved = save(p, request.revision);
    event(p.id, "chatgpt-proposal", {
      before,
      after: plan,
      instruction: request.instruction,
      decision,
    });
    res.json(saved);
  }),
);
app.put(
  "/api/projects/:id/transcript",
  wrap((req: any, res: any) => {
    const p = project(req.params.id);
    if (busy(p.id) || !p.plan)
      throw Error("Analyze first; project must be idle");
    const words = wordSchema.array().max(100000).parse(req.body.words);
    const asset = p.assets.find((a: any) => a.id === p.primary);
    if (
      words.some(
        (w, i) =>
          w.end > asset.duration || (i > 0 && w.start < words[i - 1].start),
      )
    )
      throw Error("Invalid transcript times");
    p.analysis.words = words;
    p.analysis.transcriptStatus = "imported";
    p.plan.captions = remapCaptions(p.plan, words, p.primary);
    res.json(save(p, z.number().int().parse(req.body.revision)));
  }),
);
app.post(
  "/api/projects/:id/jobs",
  wrap((req: any, res: any) => {
    const p = project(req.params.id);
    const request = z
      .object({
        type: z.enum([
          "analyze",
          "transcribe",
          "director",
          "render",
          "autoedit",
        ]),
        instruction: z.string().min(1).max(8000).optional(),
        provider: z.enum(["openai", "anthropic"]).optional(),
        aspect: z.enum(["16:9", "9:16"]).optional(),
        transcribe: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    if (!["analyze", "autoedit"].includes(request.type) && !p.plan)
      throw Error("Analyze first");
    if (request.type === "analyze" && p.plan)
      throw Error("Analysis already exists; cached perception is reused");
    if (
      ["director", "autoedit"].includes(request.type) &&
      (!request.instruction || !request.provider)
    )
      throw Error("Instruction/provider required");
    const id = enqueue(p.id, request.type, request);
    res.status(202).json({ id });
  }),
);
app.post(
  "/api/projects/:id/jobs/:job/retry",
  wrap((req: any, res: any) => {
    const p = project(req.params.id),
      job: any = db
        .prepare(
          "SELECT * FROM jobs WHERE id=? AND project=? AND status='failed'",
        )
        .get(req.params.job, p.id);
    if (!job) throw Error("Failed job not found");
    res
      .status(202)
      .json({ id: enqueue(p.id, job.type, JSON.parse(job.payload)) });
  }),
);
app.get(
  "/api/projects/:id/renders/:render",
  wrap((req: any, res: any) => {
    const r = project(req.params.id).renders.find(
      (r: any) => r.id === req.params.render,
    );
    if (!r) return res.sendStatus(404);
    res.download(r.path, "edited-video.mp4");
  }),
);
app.use(express.static(path.resolve("web-dist")));
app.get("/", (_req, res) => res.sendFile(path.resolve("web-dist/index.html")));
app.use((err: any, _req: any, res: any, _next: any) =>
  res.status(err.message?.includes("Revision conflict") ? 409 : 400).json({
    error:
      err instanceof z.ZodError
        ? "Invalid input: " +
          err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : String(err.message || "Request failed").slice(0, 1800),
  }),
);
app.listen(port, "127.0.0.1", () =>
  console.log(`Editor: http://127.0.0.1:${port}`),
);

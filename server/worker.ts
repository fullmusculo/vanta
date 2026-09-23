import { db, project, save, event, dataRoot } from "./db";
import { perceive, transcribe } from "./media";
import { roughCut } from "../src/agentic/planner";
import {
  wordSchema,
  remapCaptions,
  validatePlan,
} from "../src/agentic/contract";
import { direct } from "./director";
import { renderProject } from "./render";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
// Exactly one worker. Lock is explicit; stale lock requires operator verification after a crash.
const lockPath = path.join(dataRoot, "worker.lock");
const lock = await open(lockPath, "wx");
await lock.writeFile(String(process.pid));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
db.prepare(
  "UPDATE jobs SET status='queued',error='Recovered after worker restart' WHERE status='running'",
).run();
try {
  while (!stopping) {
    const job: any = db
      .prepare(
        "SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1",
      )
      .get();
    if (!job) {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    db.prepare(
      "UPDATE jobs SET status='running',attempts=attempts+1,updated=? WHERE id=?",
    ).run(Date.now(), job.id);
    const progress = (n: number) =>
      db
        .prepare("UPDATE jobs SET progress=?,updated=? WHERE id=?")
        .run(n, Date.now(), job.id);
    try {
      const p = project(job.project),
        payload = JSON.parse(job.payload),
        before = p.plan;
      const asset = p.assets.find((a: any) => a.id === p.primary);
      if (job.type === "autoedit") {
        if (payload.checkpointRevision !== undefined) {
          if (payload.checkpointRevision !== p.revision)
            throw Error(
              "Project changed since render checkpoint; start a new instruction",
            );
        } else {
          if (!p.analysis) {
            p.analysis = await perceive(asset, (n) => progress(n * 0.2));
          }
          if (!p.analysis.words.length) {
            p.analysis.words = wordSchema
              .array()
              .parse(await transcribe(asset));
            p.analysis.transcriptStatus = "transcribed";
          }
          if (!p.plan) {
            p.plan = roughCut(
              { id: asset.id, kind: "video", durationSeconds: asset.duration },
              p.analysis,
              payload.aspect || "16:9",
            );
            p.plan.sources = p.assets.map((a: any) => ({
              id: a.id,
              kind: a.kind,
              durationSeconds: a.duration,
            }));
          }
          progress(0.3);
          const result = await direct(p, payload.instruction, payload.provider);
          p.plan = result.plan;
          p.history.push({
            role: "director",
            text: result.decision.summary,
            instruction: payload.instruction,
            decision: result.decision,
            at: Date.now(),
          });
          event(p.id, "ai-proposal", {
            before,
            after: p.plan,
            instruction: payload.instruction,
            provider: payload.provider,
          });
          const saved = save(p, p.revision);
          p.revision = saved.revision;
          payload.checkpointRevision = p.revision;
          db.prepare("UPDATE jobs SET payload=? WHERE id=?").run(
            JSON.stringify(payload),
            job.id,
          );
        }
        const output = await renderProject(p, job.id, (n) =>
          progress(0.4 + n * 0.6),
        );
        p.renders.push({
          id: job.id,
          revision: p.revision,
          path: output,
          at: Date.now(),
        });
      } else if (job.type === "analyze") {
        p.analysis = await perceive(asset, progress);
        if (payload.transcribe) {
          p.analysis.words = wordSchema.array().parse(await transcribe(asset));
          p.analysis.transcriptStatus = "transcribed";
        }
        p.plan = roughCut(
          { id: asset.id, kind: "video", durationSeconds: asset.duration },
          p.analysis,
          payload.aspect || "16:9",
        );
        p.plan.sources = p.assets.map((a: any) => ({
          id: a.id,
          kind: a.kind,
          durationSeconds: a.duration,
        }));
        p.analysis.proxy = `/api/projects/${p.id}/proxy`;
      } else if (job.type === "transcribe") {
        if (!p.analysis) throw Error("Analyze first");
        p.analysis.words = wordSchema.array().parse(await transcribe(asset));
        p.analysis.transcriptStatus = "transcribed";
        p.plan.captions = remapCaptions(p.plan, p.analysis.words, p.primary);
      } else if (job.type === "director") {
        const result = await direct(p, payload.instruction, payload.provider);
        p.plan = result.plan;
        p.history.push({
          role: "director",
          text: result.decision.summary,
          instruction: payload.instruction,
          decision: result.decision,
          at: Date.now(),
        });
        event(p.id, "ai-proposal", {
          before,
          after: p.plan,
          instruction: payload.instruction,
          provider: payload.provider,
        });
      } else if (job.type === "render") {
        const output = await renderProject(p, job.id, progress);
        p.renders.push({
          id: job.id,
          revision: p.revision,
          path: output,
          at: Date.now(),
        });
      } else throw Error("Unknown job type");
      if (p.plan) validatePlan(p.plan);
      save(p, p.revision);
      event(p.id, job.type, { job: job.id });
      db.prepare(
        "UPDATE jobs SET status='completed',progress=1,updated=? WHERE id=?",
      ).run(Date.now(), job.id);
    } catch (e) {
      const error = (e as Error).message;
      db.prepare(
        "UPDATE jobs SET status='failed',error=?,updated=? WHERE id=?",
      ).run(error.slice(0, 1600), Date.now(), job.id);
      event(job.project, "job-failed", { id: job.id, type: job.type, error });
    }
  }
} finally {
  await lock.close();
  await unlink(lockPath);
}

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "./db";
import { validatePlan } from "../src/agentic/contract";
import { duration } from "../src/agentic/contract";
import { run } from "./media";
let bundled: Promise<string> | undefined;
export async function renderProject(
  p: any,
  job: string,
  progress: (n: number) => void,
  frameRange?: [number, number],
) {
  const plan = validatePlan(p.plan),
    token = randomBytes(24).toString("hex"),
    assets = new Map(p.assets.map((a: any) => [a.id, a]));
  const server = createServer(async (req, res) => {
    try {
      const parts = (req.url || "").split("/");
      if (parts.length !== 3 || parts[1] !== token) throw Error("Not found");
      const a: any = assets.get(parts[2]);
      if (!a) throw Error("Not found");
      const s = await stat(a.path);
      let start = 0,
        end = s.size - 1;
      const range = req.headers.range;
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!m) {
          res.writeHead(416).end();
          return;
        }
        start = +m[1];
        end = m[2] ? +m[2] : end;
        if (start > end || end >= s.size) {
          res.writeHead(416).end();
          return;
        }
      }
      res.writeHead(range ? 206 : 200, {
        "Content-Type": a.mime,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${s.size}` }
          : {}),
      });
      createReadStream(a.path, { start, end }).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as any).port;
    const media = Object.fromEntries(
      p.assets.map((a: any) => [
        a.id,
        `http://127.0.0.1:${port}/${token}/${a.id}`,
      ]),
    );
    const inputProps = { plan, media };
    bundled ??= bundle({
      entryPoint: path.resolve("src/agentic/render-entry.tsx"),
    });
    const serveUrl = await bundled;
    const browserExecutable = process.env.CHROME_PATH || undefined;
    const composition = await selectComposition({
      serveUrl,
      id: "AgenticEditor",
      inputProps,
      browserExecutable,
    });
    const dir = path.join(dataRoot, "renders");
    await mkdir(dir, { recursive: true });
    const output = path.join(dir, `${job}.mp4`),
      temp = path.join(dir, `${job}.partial.mp4`);
    const totalFrames = duration(plan);
    const spans: [number, number][] = frameRange
      ? [frameRange]
      : Array.from({ length: Math.ceil(totalFrames / 450) }, (_, i) => [
          i * 450,
          Math.min(totalFrames - 1, (i + 1) * 450 - 1),
        ]);
    const segmentDir = path.join(dir, `${job}-segments`);
    if (spans.length > 1) await mkdir(segmentDir, { recursive: true });
    const segments: string[] = [];
    try {
      for (const [i, range] of spans.entries()) {
        const segment =
          spans.length === 1
            ? temp
            : path.join(segmentDir, `${String(i).padStart(4, "0")}.mp4`);
        await renderMedia({
          composition,
          serveUrl,
          inputProps,
          codec: "h264",
          outputLocation: segment,
          browserExecutable,
          concurrency: 1,
          scale: plan.render.quality === "draft" ? 0.5 : 1,
          frameRange: range,
          onProgress: ({ progress: rendered }) =>
            progress((range[0] + rendered * (range[1] - range[0] + 1)) / totalFrames * 0.94),
          timeoutInMilliseconds: 120000,
        });
        segments.push(segment);
      }
      if (segments.length > 1) {
        const list = path.join(segmentDir, "segments.txt");
        await writeFile(
          list,
          segments.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"),
        );
        await run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
          "-i", list, "-t", String(totalFrames / plan.fps),
          "-vf", `setpts=N/(${plan.fps}*TB)`, "-fps_mode", "passthrough",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
          "-c:a", "copy",
          "-movflags", "+faststart", "-y", temp,
        ], 300000);
      }
      progress(0.99);
    } finally {
      if (segments.length > 1) await rm(segmentDir, { recursive: true, force: true });
    }
    await rename(temp, output);
    return output;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

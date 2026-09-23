import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { dataRoot } from "./db";
import { validatePlan } from "../src/agentic/contract";
let bundled: Promise<string> | undefined;
export async function renderProject(
  p: any,
  job: string,
  progress: (n: number) => void,
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
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: "h264",
      outputLocation: temp,
      browserExecutable,
      concurrency: 1,
      scale: plan.render.quality === "draft" ? 0.5 : 1,
      onProgress: ({ progress: p }) => progress(p),
      timeoutInMilliseconds: 120000,
    });
    await rename(temp, output);
    return output;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

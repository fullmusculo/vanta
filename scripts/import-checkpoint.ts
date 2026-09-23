/** Operator-only import of a previously exported local project. */
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { db, dataRoot } from "../server/db";
import { validatePlan } from "../src/agentic/contract";

const file = process.argv[2];
if (!file) throw Error("Usage: DATA_DIR=.data npm run editor:import -- /path/to/checkpoint.json");
const input = JSON.parse(await readFile(resolve(file), "utf8"));
const p = input.project || input;
if (!/^[a-f0-9]{32}$/.test(p.id) || !Number.isInteger(p.revision) || p.revision < 0)
  throw Error("Invalid project ID or revision");
if (!p.plan || !p.analysis || !Array.isArray(p.assets)) throw Error("Incomplete project checkpoint");
validatePlan(p.plan);
for (const asset of p.assets) {
  if (!asset.path || !(await stat(asset.path)).isFile()) throw Error("Missing local asset");
}
if (db.prepare("SELECT id FROM projects WHERE id=?").get(p.id)) throw Error("Project already exists; import is not an overwrite");
const source = p.assets.find((a: any) => a.id === p.primary);
if (!source || !/^[a-f0-9]{64}$/.test(source.hash)) throw Error("Invalid primary source");
if (p.analysis.frames?.length) {
  const cache = join(dataRoot, "cache", source.hash);
  await mkdir(cache, { recursive: true });
  for (const [i, frame] of p.analysis.frames.entries()) {
    if (!Number.isFinite(frame.time) || frame.time < 0 || frame.time >= source.duration)
      throw Error("Invalid sample time");
    const dest = join(cache, `mcp-frame-${i}.jpg`);
    await promisify(execFile)("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(frame.time), "-i", source.path, "-frames:v", "1", "-vf", "scale=360:-2", "-y", dest]);
    frame.file = dest;
  }
}
const { revision, ...data } = p;
db.prepare("INSERT INTO projects(id,data,revision) VALUES(?,?,?)").run(p.id, JSON.stringify(data), revision);
console.log(JSON.stringify({ id: p.id, revision, assets: p.assets.length, clips: p.plan.clips.length }));

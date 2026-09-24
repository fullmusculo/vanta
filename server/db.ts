import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const dataRoot = path.resolve(process.env.DATA_DIR || ".data");
mkdirSync(dataRoot, { recursive: true });
export const db = new DatabaseSync(path.join(dataRoot, "editor.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project TEXT NOT NULL,type TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,progress REAL DEFAULT 0,error TEXT,attempts INTEGER DEFAULT 0,created INTEGER,updated INTEGER);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,project TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,created INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS active_job ON jobs(project) WHERE status IN ('queued','running');`);
export const uid = () => randomUUID().replaceAll("-", "");
export function project(id: string): any {
  const r = db.prepare("SELECT * FROM projects WHERE id=?").get(id) as any;
  if (!r) throw Error("Project not found");
  return { ...JSON.parse(r.data), revision: r.revision };
}
export function save(p: any, expected: number) {
  const r = db
    .prepare(
      "UPDATE projects SET data=?,revision=revision+1 WHERE id=? AND revision=?",
    )
    .run(JSON.stringify(p), p.id, expected);
  if (!r.changes) throw Error("Revision conflict: reload project");
  return project(p.id);
}
export function event(p: string, kind: string, data: any) {
  db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
    uid(),
    p,
    kind,
    JSON.stringify(data),
    Date.now(),
  );
}
export function enqueue(p: string, type: string, payload: any) {
  const id = uid();
  db.prepare(
    "INSERT INTO jobs(id,project,type,status,payload,created,updated) VALUES(?,?,?,?,?,?,?)",
  ).run(id, p, type, "queued", JSON.stringify(payload), Date.now(), Date.now());
  return id;
}
export function busy(p: string) {
  return !!db
    .prepare(
      "SELECT id FROM jobs WHERE project=? AND status IN ('queued','running')",
    )
    .get(p);
}

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:4317/api";
async function request(route: string, method = "GET", body?: any) {
  const r = await fetch(base + route, {
    method,
    ...(body instanceof FormData
      ? { body }
      : body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data;
}
async function complete(id: string) {
  for (let i = 0; i < 240; i++) {
    const p = await request("/projects/" + id);
    const job = p.jobs[0];
    if (job.status === "failed") throw Error(job.error);
    if (job.status === "completed") return p;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Timed out");
}
const data = new FormData();
data.set(
  "file",
  new Blob([await readFile("/tmp/vanta-input.mp4")], { type: "video/mp4" }),
  "Synthetic autoedit fixture.mp4",
);
let p = await request("/projects", "POST", data);
await request(`/projects/${p.id}/jobs`, "POST", {
  type: "autoedit",
  provider: "openai",
  instruction: "Create a controlled test edit",
});
p = await complete(p.id);
assert.equal(p.renders.length, 1);
assert.equal(p.history.length, 1);
assert.equal(p.plan.clips[0].zoom, 1.2);
const before = structuredClone(p.plan);
assert.ok(p.analysis.words.length);
await request(`/projects/${p.id}/jobs`, "POST", {
  type: "director",
  provider: "openai",
  instruction: "Haz el primer minuto más dinámico y reduce las transiciones.",
});
p = await complete(p.id);
assert.equal(p.history.length, 2);
assert.equal(p.plan.clips[0].zoom, 1.1);
assert.equal(p.plan.clips[0].transition, "cut");
assert.deepEqual(p.plan.clips[1], before.clips[1]);
assert.deepEqual(p.plan.sources, before.sources);
const events = await request(`/projects/${p.id}/events`);
assert.equal(events.filter((e: any) => e.kind === "ai-proposal").length, 2);
console.log(
  "PASS automatic pipeline + incremental follow-up with MOCKED provider transport; real media analysis/render. Live AI remains unverified.",
);

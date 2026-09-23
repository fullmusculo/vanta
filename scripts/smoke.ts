import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const host = "http://127.0.0.1:4317";
async function api(route: string, method = "GET", body?: any) {
  const r = await fetch(host + "/api" + route, {
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
  const out = await r.json();
  if (!r.ok) throw Error(JSON.stringify(out));
  return out;
}
async function wait(id: string) {
  for (let i = 0; i < 240; i++) {
    const p = await api("/projects/" + id);
    const j = p.jobs[0];
    if (j.status === "failed") throw Error(j.error);
    if (j.status === "completed") return p;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error("Job timeout");
}
const form = new FormData();
form.set(
  "file",
  new Blob([await readFile("/tmp/vanta-input.mp4")], { type: "video/mp4" }),
  "Test pattern with known silence.mp4",
);
let p = await api("/projects", "POST", form);
console.log("Uploaded", p.id);
await api(`/projects/${p.id}/jobs`, "POST", { type: "analyze" });
p = await wait(p.id);
assert.ok(p.plan.removed.length);
assert.ok(p.plan.clips.length >= 2);
console.log("Analyzed", p.analysis.silences, p.plan.clips.length);
const words = [
  { word: "Vídeo", start: 0.4, end: 0.7, confidence: 1 },
  { word: "de", start: 0.8, end: 1, confidence: 1 },
  { word: "prueba", start: 1.1, end: 1.5, confidence: 1 },
  { word: "Edición", start: 4.5, end: 5.2, confidence: 1 },
  { word: "verificada", start: 5.3, end: 6, confidence: 1 },
];
p = await api(`/projects/${p.id}/transcript`, "PUT", {
  words,
  revision: p.revision,
});
const music = new FormData();
music.set(
  "file",
  new Blob([await readFile("/tmp/vanta-music.wav")], { type: "audio/wav" }),
  "Test tone (not production music).wav",
);
p = await api(`/projects/${p.id}/assets`, "POST", music);
const d = p.plan.clips.reduce(
  (n: number, c: any) => n + Math.round((c.outFrame - c.inFrame) / c.speed),
  0,
);
p.plan.clips[1].zoom = 1.2;
p.plan.clips[1].transition = "fade-black";
p.plan.clips[1].transitionFrames = 6;
p.plan.overlays = [
  {
    id: "graphic1",
    start: 5,
    end: 50,
    type: "lower-third",
    text: "PRUEBA DEL MOTOR",
    sourceId: null,
    x: 0.5,
    y: 0.12,
    scale: 0.65,
    confidence: 1,
    reason: "Synthetic integration fixture",
  },
];
p.plan.audio = [
  {
    id: "music1",
    sourceId: p.assets[1].id,
    start: 0,
    end: d,
    volume: 0.12,
    ducking: true,
    role: "music",
    confidence: 1,
    reason: "Synthetic integration fixture",
  },
];
p = await api(`/projects/${p.id}/plan`, "PUT", {
  plan: p.plan,
  revision: p.revision,
});
// Invalid plan must never mutate the project; stale revisions must not overwrite.
const broken = structuredClone(p.plan);
broken.clips[0].outFrame = 999999;
const bad = await fetch(host + `/api/projects/${p.id}/plan`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan: broken, revision: p.revision }),
});
assert.equal(bad.status, 400);
assert.equal((await api("/projects/" + p.id)).revision, p.revision);
const stale = await fetch(host + `/api/projects/${p.id}/plan`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ plan: p.plan, revision: p.revision - 1 }),
});
assert.equal(stale.status, 409);
await api(`/projects/${p.id}/jobs`, "POST", { type: "render" });
p = await wait(p.id);
console.log("Rendered 16:9", p.renders.at(-1));
p.plan.aspect = "9:16";
p = await api(`/projects/${p.id}/plan`, "PUT", {
  plan: p.plan,
  revision: p.revision,
});
await api(`/projects/${p.id}/jobs`, "POST", { type: "render" });
p = await wait(p.id);
console.log("Rendered 9:16", p.renders.at(-1));
await writeFile("/tmp/vanta-smoke-result.json", JSON.stringify(p, null, 2));
console.log(
  "PASS ingestion / perception / imported captions / edits / validation / revision protection / render in both formats",
);

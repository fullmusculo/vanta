import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const picture = new FormData();
picture.set(
  "file",
  new Blob([await readFile("/tmp/vanta-image.png")], { type: "image/png" }),
  "Synthetic overlay.png",
);
p = await api(`/projects/${p.id}/assets`, "POST", picture);
assert.equal(p.assets.at(-1).kind, "image");
const forged = new FormData();
forged.set(
  "file",
  new Blob(["#EXTM3U\nhttp://127.0.0.1/private"], { type: "video/mp4" }),
  "not-video.mp4",
);
const reject = await fetch(host + "/api/projects", {
  method: "POST",
  body: forged,
});
assert.equal(reject.status, 400);
const cross = await fetch(host + "/api/projects", {
  headers: { Origin: "https://untrusted.example" },
});
assert.equal(cross.status, 403);
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
p.plan.overlays.push({
  id: "image1",
  start: 70,
  end: 90,
  type: "image",
  text: "",
  sourceId: p.assets.at(-1).id,
  x: 0.8,
  y: 0.1,
  scale: 0.15,
  confidence: 1,
  reason: "Synthetic image fixture",
});
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
const chatDecision = {
  summary: "Accent the second section for review",
  operations: [
    {
      type: "set-clip",
      clip: {
        ...p.plan.clips[1],
        zoom: 1.16,
        confidence: 0.92,
        reason: "Requested visible emphasis in this segment",
      },
    },
  ],
};
const revisionBeforeChat = p.revision;
const rejectedChat = await fetch(host + `/api/projects/${p.id}/decisions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    revision: revisionBeforeChat,
    instruction: "Accent section two",
    decision: { ...chatDecision, serverUrl: "http://127.0.0.1" },
  }),
});
assert.equal(rejectedChat.status, 400);
assert.equal((await api("/projects/" + p.id)).revision, revisionBeforeChat);
p = await api(`/projects/${p.id}/decisions`, "POST", {
  revision: revisionBeforeChat,
  instruction: "Accent section two",
  decision: chatDecision,
});
assert.equal(p.plan.clips[1].zoom, 1.16);
assert.equal(p.history.at(-1).source, "chatgpt-interactive");
const staleChat = await fetch(host + `/api/projects/${p.id}/decisions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    revision: revisionBeforeChat,
    instruction: "repeat",
    decision: chatDecision,
  }),
});
assert.equal(staleChat.status, 409);
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
for (const render of p.renders) {
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "quiet", "-show_streams", "-of", "json", render.path],
      { encoding: "utf8" },
    ),
  );
  const video = info.streams.find((s: any) => s.codec_type === "video");
  assert.equal(+video.nb_frames, d);
  assert.equal(video.codec_name, "h264");
  assert.ok(info.streams.some((s: any) => s.codec_name === "aac"));
}
console.log(
  "PASS ingestion / perception / imported captions / edits / validation / revision protection / render in both formats",
);

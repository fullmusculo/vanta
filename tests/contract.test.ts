import { test } from "node:test";
import assert from "node:assert/strict";
import { roughCut, Analysis } from "../src/agentic/planner";
import {
  validatePlan,
  duration,
  remapCaptions,
  timeline,
} from "../src/agentic/contract";
import { applyDecision } from "../server/director";
const analysis: Analysis = {
  duration: 10,
  silences: [{ start: 3, end: 5 }],
  words: [
    { word: "Hola", start: 1, end: 1.3, confidence: 0.9 },
    { word: "mundo", start: 6, end: 6.6, confidence: 0.9 },
  ],
  transcriptStatus: "imported",
  frames: [],
  audio: { meanDb: -20, maxDb: -5 },
  sceneChanges: [],
};
const base = () =>
  roughCut(
    { id: "video1", kind: "video", durationSeconds: 10 },
    analysis,
    "16:9",
  );
test("Silence cuts preserve handles and deterministic source mapping", () => {
  const p = base();
  assert.equal(p.clips.length, 2);
  assert.equal(p.clips[0].outFrame, 94);
  assert.equal(p.clips[1].inFrame, 146);
  assert.equal(duration(p), 248);
  assert.deepEqual(base(), p);
  assert.equal(timeline(p)[1].start, 94);
});
test("Words are remapped to output after silence deletion", () => {
  const p = base();
  assert.ok(Math.abs(p.captions[1].words[0].start - (6 - 52 / 30)) < 1e-6);
  assert.equal(p.captions[0].words[0].start, 1);
});
test("Speech prevents a proposed silence cut", () => {
  const a = structuredClone(analysis);
  a.words.push({ word: "no", start: 4, end: 4.3, confidence: 1 });
  assert.equal(
    roughCut({ id: "a", kind: "video", durationSeconds: 10 }, a, "9:16").removed
      .length,
    0,
  );
});
test("Unknown model fields and URL injection rejected", () => {
  assert.throws(() =>
    validatePlan({ ...base(), serverUrl: "http://169.254.169.254" }),
  );
  const p = base();
  (p.sources[0] as any).url = "file:///etc/passwd";
  assert.throws(() => validatePlan(p));
});
test("Negative/reversed/out-of-source trims and NaN rejected", () => {
  for (const patch of [
    { inFrame: -1 },
    { outFrame: 0 },
    { outFrame: 301 },
    { zoom: NaN },
  ]) {
    const p = base();
    Object.assign(p.clips[0], patch);
    assert.throws(() => validatePlan(p));
  }
});
test("Duplicate IDs and unknown source IDs rejected", () => {
  const p = base();
  p.clips[1].id = p.clips[0].id;
  assert.throws(() => validatePlan(p));
  p.clips[1].id = "ok";
  p.clips[1].sourceId = "missing";
  assert.throws(() => validatePlan(p));
});
test("Removed and kept ranges cannot overlap", () => {
  const p = base();
  p.removed[0].inFrame = 0;
  assert.throws(() => validatePlan(p));
});
test("Audio and overlays must reference allowed assets and fit timeline", () => {
  const p = base();
  p.audio = [
    {
      id: "music",
      sourceId: "video1",
      start: 0,
      end: duration(p),
      volume: 0.2,
      ducking: true,
      role: "music",
      confidence: 1,
      reason: "test",
    },
  ];
  assert.throws(() => validatePlan(p));
  p.audio = [];
  p.overlays = [
    {
      id: "t",
      start: 0,
      end: 999,
      type: "title",
      text: "test",
      sourceId: null,
      x: 0.5,
      y: 0.5,
      scale: 0.8,
      confidence: 1,
      reason: "test",
    },
  ];
  assert.throws(() => validatePlan(p));
});
test("Motion graphics require a bounded preset and factual counter value", () => {
  const p = base();
  p.overlays.push({
    id: "motion1", start: 0, end: 65, type: "motion", text: "Idea principal",
    sourceId: null, x: 0.5, y: 0.2, scale: 0.7,
    confidence: 1, reason: "Texto verificado", motion: {
      preset: "kinetic-title", enterFrames: 8, exitFrames: 8,
      value: null, suffix: "",
    },
  });
  assert.doesNotThrow(() => validatePlan(p));
  p.overlays[0].motion!.enterFrames = 60;
  assert.throws(() => validatePlan(p));
  p.overlays[0].motion!.enterFrames = 8;
  p.overlays[0].motion!.preset = "stat-counter";
  assert.throws(() => validatePlan(p));
  p.overlays[0].motion!.value = 15;
  assert.doesNotThrow(() => validatePlan(p));
});
test("Incremental direction preserves untouched clips and original object", () => {
  const p = base(),
    before = structuredClone(p);
  const next = applyDecision(
    p,
    {
      summary: "Punch in",
      operations: [{ type: "set-clip", clip: { ...p.clips[0], zoom: 1.2 } }],
    },
    analysis,
    "video1",
  ).plan;
  assert.equal(next.clips[0].zoom, 1.2);
  assert.deepEqual(next.clips[1], p.clips[1]);
  assert.deepEqual(p, before);
});
test("Invalid AI proposal is atomic and never changes current plan", () => {
  const p = base(),
    before = structuredClone(p);
  assert.throws(() =>
    applyDecision(
      p,
      {
        summary: "bad",
        operations: [
          { type: "set-clip", clip: { ...p.clips[0], zoom: 1.2 } },
          { type: "remove-clip", clipId: "missing" },
        ],
      },
      analysis,
      "video1",
    ),
  );
  assert.deepEqual(p, before);
});
test("Split conserves source/output duration and recomputes captions", () => {
  const p = base(),
    next = applyDecision(
      p,
      {
        summary: "split",
        operations: [
          {
            type: "split-clip",
            clipId: p.clips[1].id,
            atSourceFrame: 200,
            newId: "split1",
          },
        ],
      },
      analysis,
      "video1",
    ).plan;
  assert.equal(duration(next), duration(p));
  assert.equal(next.clips.length, 3);
});
test("Speed change maps caption timing consistently", () => {
  const p = base();
  p.clips[0].speed = 2;
  p.captions = remapCaptions(p, analysis.words, "video1");
  assert.equal(p.captions[0].words[0].start, 0.5);
  validatePlan(p);
});
test("Transition longer than clip rejected", () => {
  const p = base();
  p.clips[0].outFrame = 10;
  p.clips[0].transitionFrames = 10;
  assert.throws(() => validatePlan(p));
});
test("All-silence footage remains reviewable instead of empty output", () => {
  const p = roughCut(
    { id: "v", kind: "video", durationSeconds: 10 },
    { ...analysis, words: [], silences: [{ start: 0, end: 10 }] },
    "16:9",
  );
  assert.ok(duration(p) > 0);
});

import {
  EditPlan,
  neutralProfile,
  validatePlan,
  remapCaptions,
  Word,
} from "./contract";
export type Analysis = {
  duration: number;
  silences: { start: number; end: number }[];
  words: Word[];
  transcriptStatus: "missing" | "imported" | "transcribed";
  frames: { file: string; time: number }[];
  audio: { meanDb: number | null; maxDb: number | null };
  sceneChanges: number[];
};
export function roughCut(
  source: EditPlan["sources"][number],
  a: Analysis,
  aspect: EditPlan["aspect"],
): EditPlan {
  const p: EditPlan = {
    version: "1.0",
    fps: 30,
    aspect,
    sources: [source],
    clips: [],
    removed: [],
    captions: [],
    overlays: [],
    audio: [],
    profile: neutralProfile,
    render: { codec: "h264", quality: "draft" },
  };
  const removals = a.silences
    .filter((s) => s.end - s.start > neutralProfile.maxSilenceSeconds + 0.2)
    .map((s) => ({
      start: Math.ceil((s.start + 0.12) * 30),
      end: Math.floor((s.end - 0.12) * 30),
    }))
    .filter(
      (s) =>
        s.end > s.start &&
        !a.words.some((w) => w.start * 30 < s.end && w.end * 30 > s.start),
    );
  let at = 0;
  const limit = Math.floor(source.durationSeconds * 30);
  const add = (from: number, to: number) => {
    if (to - from >= 2)
      p.clips.push({
        id: `clip_${p.clips.length}`,
        sourceId: source.id,
        inFrame: from,
        outFrame: to,
        speed: 1,
        zoom: 1,
        x: 0.5,
        y: 0.5,
        volume: 1,
        transition: "cut",
        transitionFrames: 0,
        brightness: 1,
        contrast: 1,
        saturation: 1,
        confidence: 0.8,
        reason: "Conservar contenido; corte técnico por silencio",
      });
  };
  for (const r of removals) {
    const end = Math.min(limit, r.end);
    if (r.start < at || r.start >= limit) continue;
    add(at, r.start);
    p.removed.push({
      id: `remove_${p.removed.length}`,
      sourceId: source.id,
      inFrame: r.start,
      outFrame: end,
      confidence: 0.8,
      reason: "Silencio detectado por FFmpeg con margen de respiración",
    });
    at = end;
  }
  add(at, limit);
  if (!p.clips.length) {
    p.removed = [];
    add(0, limit);
  }
  p.captions = remapCaptions(p, a.words, source.id);
  return validatePlan(p);
}

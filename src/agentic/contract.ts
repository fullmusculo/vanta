import { z } from "zod";
const frame = z.number().int().min(0).max(648000),
  id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const meta = {
  id,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(1000),
};
export const sourceSchema = z
  .object({
    id,
    kind: z.enum(["video", "audio", "image"]),
    durationSeconds: z.number().positive().max(7200),
  })
  .strict();
export const clipSchema = z
  .object({
    ...meta,
    sourceId: id,
    inFrame: frame,
    outFrame: frame,
    speed: z.number().min(0.5).max(2),
    zoom: z.number().min(1).max(2),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    volume: z.number().min(0).max(2),
    transition: z.enum(["cut", "fade-black"]),
    transitionFrames: z.number().int().min(0).max(30),
    brightness: z.number().min(0.5).max(1.5),
    contrast: z.number().min(0.5).max(1.5),
    saturation: z.number().min(0).max(2),
  })
  .strict();
export const wordSchema = z
  .object({
    word: z.string().min(1).max(100),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .refine((w) => w.end > w.start, "Invalid word range");
export type Word = z.infer<typeof wordSchema>;
export const overlaySchema = z
  .object({
    ...meta,
    start: frame,
    end: frame,
    type: z.enum(["title", "lower-third", "image", "broll", "stat"]),
    text: z.string().max(300),
    sourceId: id.nullable(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    scale: z.number().min(0.1).max(1),
  })
  .strict();
export const audioSchema = z
  .object({
    ...meta,
    sourceId: id,
    start: frame,
    end: frame,
    volume: z.number().min(0).max(1),
    ducking: z.boolean(),
    role: z.enum(["music", "sfx"]),
  })
  .strict();
export const profileSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    brandVerified: z.boolean(),
    cutPaceSeconds: z.number().min(2).max(60),
    punchInEvery: z.number().int().min(0).max(20),
    maxSilenceSeconds: z.number().min(0.2).max(3),
    visualIntensity: z.enum(["calm", "balanced", "dynamic"]),
    fontFamily: z.enum(["Arial", "Verdana", "Georgia"]),
    captionColor: hex,
    accentColor: hex,
    safeArea: z.number().min(0.08).max(0.25),
    captionWords: z.number().int().min(2).max(10),
    transition: z.enum(["cut", "fade-black"]),
    musicVolume: z.number().min(0).max(0.3),
    broll: z.enum(["off", "manual"]),
    logoAssetId: id.nullable(),
  })
  .strict();
export const neutralProfile: z.infer<typeof profileSchema> = {
  id: "fullmusculo-draft",
  label: "FullMúsculo · perfil por configurar",
  brandVerified: false,
  cutPaceSeconds: 8,
  punchInEvery: 3,
  maxSilenceSeconds: 0.65,
  visualIntensity: "balanced",
  fontFamily: "Arial",
  captionColor: "#ffffff",
  accentColor: "#ffffff",
  safeArea: 0.16,
  captionWords: 5,
  transition: "cut",
  musicVolume: 0.12,
  broll: "manual",
  logoAssetId: null,
};
export const planSchema = z
  .object({
    version: z.literal("1.0"),
    fps: z.literal(30),
    aspect: z.enum(["16:9", "9:16"]),
    sources: z.array(sourceSchema).min(1).max(50),
    clips: z.array(clipSchema).min(1).max(500),
    removed: z
      .array(
        z
          .object({ ...meta, sourceId: id, inFrame: frame, outFrame: frame })
          .strict(),
      )
      .max(500),
    captions: z
      .array(
        z
          .object({
            ...meta,
            start: frame,
            end: frame,
            words: z.array(wordSchema).min(1).max(10),
          })
          .strict(),
      )
      .max(10000),
    overlays: z.array(overlaySchema).max(100),
    audio: z.array(audioSchema).max(30),
    profile: profileSchema,
    render: z
      .object({ codec: z.literal("h264"), quality: z.enum(["draft", "final"]) })
      .strict(),
  })
  .strict();
export type EditPlan = z.infer<typeof planSchema>;
export type Clip = z.infer<typeof clipSchema>;
export const clipDuration = (c: Clip) =>
  Math.round((c.outFrame - c.inFrame) / c.speed);
export const duration = (p: EditPlan) =>
  p.clips.reduce((n, c) => n + clipDuration(c), 0);
export function validatePlan(
  input: unknown,
  canonical?: EditPlan["sources"],
): EditPlan {
  const p = planSchema.parse(input),
    ids = new Set<string>(),
    sources = new Map(p.sources.map((s) => [s.id, s]));
  if (sources.size !== p.sources.length) throw Error("Duplicate source ID");
  if (canonical && JSON.stringify(p.sources) !== JSON.stringify(canonical))
    throw Error("Sources are immutable");
  const checkId = (i: string) => {
    if (ids.has(i)) throw Error("Duplicate action ID");
    ids.add(i);
  };
  for (const c of p.clips) {
    checkId(c.id);
    const s = sources.get(c.sourceId);
    if (
      !s ||
      s.kind !== "video" ||
      c.outFrame <= c.inFrame ||
      c.outFrame > Math.floor(s.durationSeconds * p.fps) ||
      clipDuration(c) < 2 ||
      c.transitionFrames * 2 > clipDuration(c)
    )
      throw Error("Invalid clip range/source/transition");
  }
  const total = duration(p);
  if (total > 108000) throw Error("MVP output limit: 60 minutes");
  for (const r of p.removed) {
    checkId(r.id);
    const s = sources.get(r.sourceId);
    if (!s || r.outFrame <= r.inFrame || r.outFrame > s.durationSeconds * p.fps)
      throw Error("Invalid removal");
    if (
      p.clips.some(
        (c) =>
          c.sourceId === r.sourceId &&
          c.inFrame < r.outFrame &&
          c.outFrame > r.inFrame,
      )
    )
      throw Error("Removed segment overlaps kept footage");
  }
  for (const a of [...p.captions, ...p.overlays, ...p.audio]) {
    checkId(a.id);
    if (a.end <= a.start || a.end > total)
      throw Error("Action outside timeline");
  }
  for (const c of p.captions)
    for (const w of c.words)
      if (w.start * 30 < c.start - 1 || w.end * 30 > c.end + 1)
        throw Error("Caption word outside caption range");
  for (const o of p.overlays) {
    if (["image", "broll"].includes(o.type)) {
      const s = sources.get(o.sourceId || "");
      if (!s || s.kind !== (o.type === "image" ? "image" : "video"))
        throw Error("Invalid overlay asset");
      if (o.type === "broll" && (o.end - o.start) / 30 > s.durationSeconds)
        throw Error("B-roll exceeds source");
    } else if (o.sourceId !== null)
      throw Error("Text overlay cannot reference asset");
  }
  if (
    p.profile.logoAssetId &&
    sources.get(p.profile.logoAssetId)?.kind !== "image"
  )
    throw Error("Invalid logo asset");
  for (const a of p.audio) {
    if (sources.get(a.sourceId)?.kind !== "audio")
      throw Error("Invalid audio asset");
    if (
      a.role === "sfx" &&
      (a.end - a.start) / 30 > sources.get(a.sourceId)!.durationSeconds
    )
      throw Error("SFX exceeds source");
  }
  return p;
}
export function timeline(p: EditPlan) {
  let at = 0;
  return p.clips.map((c) => {
    const t = { ...c, start: at, end: at + clipDuration(c) };
    at = t.end;
    return t;
  });
}
export function remapCaptions(
  p: EditPlan,
  words: Word[],
  sourceId: string,
): EditPlan["captions"] {
  const out: EditPlan["captions"] = [];
  for (const clip of timeline(p).filter((c) => c.sourceId === sourceId)) {
    const mapped = words
      .filter(
        (w) => w.start >= clip.inFrame / 30 && w.end <= clip.outFrame / 30,
      )
      .sort((a, b) => a.start - b.start)
      .map((w) => ({
        ...w,
        start: clip.start / 30 + (w.start - clip.inFrame / 30) / clip.speed,
        end: clip.start / 30 + (w.end - clip.inFrame / 30) / clip.speed,
      }));
    for (let i = 0; i < mapped.length; i += p.profile.captionWords) {
      const group = mapped.slice(i, i + p.profile.captionWords);
      out.push({
        id: `cap_${clip.id}_${i}`,
        start: Math.floor(group[0].start * 30),
        end: Math.min(clip.end, Math.ceil(group.at(-1)!.end * 30)),
        words: group,
        confidence: Math.min(...group.map((w) => w.confidence)),
        reason: "Transcript aligned to kept source ranges",
      });
    }
  }
  return out;
}

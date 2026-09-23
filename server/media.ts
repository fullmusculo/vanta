import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, stat, open } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./db";
import { Analysis } from "../src/agentic/planner";
import { displayDimensions, volumeFromLog } from "./media-metadata";
export async function run(
  bin: string,
  args: string[],
  timeout = 300000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    const append = (b: Buffer) => {
      output += b.toString();
      if (output.length > 8e6) {
        child.kill("SIGKILL");
        reject(Error("Process output limit"));
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(output)
        : reject(Error(`${bin} failed (${code}): ${output.slice(-1200)}`));
    });
  });
}
export async function hash(file: string) {
  const h = createHash("sha256");
  for await (const c of createReadStream(file)) h.update(c);
  return h.digest("hex");
}
export async function inspect(file: string) {
  const handle = await open(file, "r");
  const head = Buffer.alloc(16);
  try {
    await handle.read(head, 0, 16, 0);
  } finally {
    await handle.close();
  }
  const magic = head.toString("ascii");
  const image =
    head
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (head[0] === 255 && head[1] === 216 && head[2] === 255);
  if (image && (await stat(file)).size > 20 * 1024 * 1024)
    throw Error("Image limit: 20 MB");
  const allowed =
    image ||
    magic.slice(4, 8) === "ftyp" ||
    magic.slice(0, 4) === "RIFF" ||
    magic.slice(0, 3) === "ID3" ||
    magic.slice(0, 4) === "OggS" ||
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
    (head[0] === 255 && (head[1] & 224) === 224);
  if (!allowed)
    throw Error("Unsupported container signature; playlists are forbidden");
  const info = JSON.parse(
    await run(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-protocol_whitelist",
        "file,pipe",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        file,
      ],
      30000,
    ),
  );
  const video = info.streams.find((s: any) => s.codec_type === "video"),
    audio = info.streams.find((s: any) => s.codec_type === "audio");
  const duration = image ? 3600 : Number(info.format?.duration);
  if (!Number.isFinite(duration) || duration < 0.2 || duration > 3600)
    throw Error("Media must be between 0.2 seconds and 60 minutes");
  if (!video && !audio) throw Error("No supported media stream");
  if (video && (video.width > 7680 || video.height > 7680))
    throw Error("Resolution limit: 7680");
  return {
    duration,
    image,
    mime: image
      ? head[0] === 137
        ? "image/png"
        : "image/jpeg"
      : magic.slice(4, 8) === "ftyp"
        ? video
          ? "video/mp4"
          : "audio/mp4"
        : magic.slice(0, 4) === "RIFF"
          ? "audio/wav"
          : magic.slice(0, 4) === "OggS"
            ? "audio/ogg"
            : head[0] === 0x1a
              ? "video/webm"
              : "audio/mpeg",
    video: !!video,
    audio: !!audio,
    ...displayDimensions(video),
  };
}
export async function perceive(
  asset: any,
  progress: (n: number) => void,
): Promise<Analysis> {
  const dir = path.join(dataRoot, "cache", asset.hash);
  await mkdir(dir, { recursive: true });
  const cache = path.join(dir, "analysis-v2.json");
  try {
    return JSON.parse(await readFile(cache, "utf8"));
  } catch {}
  const file = asset.path;
  progress(0.1);
  const input = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    file,
  ];
  await run("ffmpeg", [
    ...input,
    "-vf",
    "scale=640:640:force_original_aspect_ratio=decrease",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "28",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    path.join(dir, "proxy.mp4"),
  ]);
  progress(0.35);
  const silences: { start: number; end: number }[] = [];
  let meanDb = null,
    maxDb = null;
  if (asset.audio) {
    await run("ffmpeg", [
      ...input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      path.join(dir, "audio.wav"),
    ]);
    const log = await run("ffmpeg", [
      ...input,
      "-vn",
      "-af",
      "silencedetect=noise=-35dB:d=0.35,volumedetect",
      "-f",
      "null",
      "-",
    ]);
    let start = 0;
    for (const line of log.split("\n")) {
      const s = line.match(/silence_start: ([\d.]+)/),
        e = line.match(/silence_end: ([\d.]+)/);
      if (s) start = +s[1];
      if (e) silences.push({ start, end: Math.min(+e[1], asset.duration) });
    }
    meanDb = volumeFromLog(log, "mean");
    maxDb = volumeFromLog(log, "max");
  }
  progress(0.6);
  const frames = [];
  for (let i = 0; i < 6; i++) {
    const time = Math.min(asset.duration - 0.05, (asset.duration * i) / 6),
      frameFile = path.join(dir, `frame-${i}.jpg`);
    await run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-ss",
      String(time),
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      frameFile,
    ]);
    frames.push({ file: frameFile, time });
  }
  const sceneLog = await run("ffmpeg", [
    ...input,
    "-an",
    "-vf",
    "select='gt(scene,0.35)',showinfo",
    "-vsync",
    "vfr",
    "-f",
    "null",
    "-",
  ]);
  const sceneChanges = [...sceneLog.matchAll(/pts_time:([\d.]+)/g)].map(
    (m) => +m[1],
  );
  const a: Analysis = {
    duration: asset.duration,
    silences,
    words: [],
    transcriptStatus: "missing",
    frames,
    audio: { meanDb, maxDb },
    sceneChanges,
  };
  await writeFile(cache, JSON.stringify(a));
  progress(0.8);
  return a;
}
export async function transcribe(asset: any) {
  const key = process.env.OPENAI_API_KEY;
  if (!key)
    throw Error(
      "Configure OPENAI_API_KEY or import a word-timestamp transcript",
    );
  const file = path.join(dataRoot, "cache", asset.hash, "audio.wav");
  const cache = path.join(dataRoot, "cache", asset.hash, "whisper-v1.json");
  try {
    return JSON.parse(await readFile(cache, "utf8"));
  } catch {}
  const bytes = await readFile(file);
  if (bytes.length > 24 * 1024 * 1024)
    throw Error(
      "ASR MVP limit: 24 MB extracted audio; import transcript or use shorter source",
    );
  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav");
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(180000),
    redirect: "error",
  });
  if (!res.ok) throw Error(`Transcription provider HTTP ${res.status}`);
  const result: any = await res.json();
  const words = (result.words || []).map((w: any) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    confidence: 0.8,
  }));
  if (!words.length) throw Error("Provider returned no timed words");
  await writeFile(cache, JSON.stringify(words));
  return words;
}

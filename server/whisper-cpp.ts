import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dataRoot } from "./db";
import { wordSchema, Word } from "../src/agentic/contract";

/** whisper.cpp's full JSON reports timed tokens. Merge adjacent subword tokens. */
export function parseWhisperCppTranscript(raw: unknown, duration: number): Word[] {
  const segments = (raw as any)?.transcription;
  if (!Array.isArray(segments)) throw Error("whisper.cpp returned no transcription");
  const words: Word[] = [];
  for (const segment of segments) {
    if (!Array.isArray(segment.tokens)) throw Error("whisper.cpp returned no timed tokens");
    for (const token of segment.tokens) {
      const text = token?.text;
      const start = token?.offsets?.from / 1000;
      const end = token?.offsets?.to / 1000;
      if (typeof text !== "string" || /^\[_.+_\]$/.test(text.trim()) || /^<\|.*\|>$/.test(text.trim())) continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > duration + 0.1) continue;
      const value = text.trim();
      if (!value) continue;
      const confidence = Math.min(1, Math.max(0, Number.isFinite(token.p) ? token.p : 0.5));
      const prior = words.at(-1);
      if (prior && ((!/^\s/.test(text) && start <= prior.end + 0.5) || /^[.,!?;:…]$/.test(value))) {
        prior.word += value;
        prior.end = Math.max(prior.end, end);
        prior.confidence = Math.min(prior.confidence, confidence);
      } else {
        words.push({ word: value, start, end, confidence });
      }
    }
  }
  if (!words.length) throw Error("whisper.cpp returned no timed words");
  return wordSchema.array().max(100000).parse(words);
}

export async function transcribeLocal(asset: any, wav: string): Promise<Word[]> {
  const binary = process.env.WHISPER_CPP_BIN;
  const model = process.env.WHISPER_CPP_MODEL;
  if (!binary || !model) throw Error("Set WHISPER_CPP_BIN and WHISPER_CPP_MODEL");
  if (!path.isAbsolute(binary) || !path.isAbsolute(model))
    throw Error("Local ASR executable and model paths must be absolute");
  const modelInfo = await stat(model);
  if (!modelInfo.isFile() || !(await stat(binary)).isFile())
    throw Error("Local ASR executable/model missing");
  const dir = path.join(dataRoot, "cache", asset.hash);
  await mkdir(dir, { recursive: true });
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([model, modelInfo.size, modelInfo.mtimeMs]))
    .digest("hex").slice(0, 16);
  const outputBase = path.join(dir, `whisper-cpp-${fingerprint}`);
  const cached = `${outputBase}-words.json`;
  try {
    return wordSchema.array().parse(JSON.parse(await readFile(cached, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await promisify(execFile)(binary, [
    "--model", model, "--file", wav, "--language", "es",
    "--output-json-full", "--output-file", outputBase,
    "--no-prints", "--no-gpu",
  ], { timeout: 1800000, maxBuffer: 8 * 1024 * 1024 });
  const words = parseWhisperCppTranscript(JSON.parse(await readFile(`${outputBase}.json`, "utf8")), asset.duration);
  await writeFile(cached, JSON.stringify(words));
  return words;
}

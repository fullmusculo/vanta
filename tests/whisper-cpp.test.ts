import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhisperCppTranscript } from "../server/whisper-cpp";

test("whisper.cpp full JSON merges timed subwords and punctuation", () => {
  const result = parseWhisperCppTranscript({ transcription: [{ tokens: [
    { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
    { text: " Ho", offsets: { from: 100, to: 250 }, p: 0.9 },
    { text: "la", offsets: { from: 250, to: 460 }, p: 0.8 },
    { text: ",", offsets: { from: 460, to: 500 }, p: 0.7 },
    { text: " mundo", offsets: { from: 520, to: 900 }, p: 0.95 },
  ] }] }, 1);
  assert.deepEqual(result, [
    { word: "Hola,", start: 0.1, end: 0.5, confidence: 0.7 },
    { word: "mundo", start: 0.52, end: 0.9, confidence: 0.95 },
  ]);
});

test("whisper.cpp parser does not turn missing or invalid timing into captions", () => {
  assert.throws(() => parseWhisperCppTranscript({ transcription: [{ text: "Inventado" }] }, 10));
  assert.throws(() => parseWhisperCppTranscript({ transcription: [{ tokens: [
    { text: " falso", offsets: { from: 11000, to: 12000 }, p: 1 },
  ] }] }, 10));
});

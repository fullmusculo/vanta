import { spawnSync } from "node:child_process";
function ffmpeg(args) {
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw Error("Fixture generation failed");
}
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=640x360:rate=30:duration=8",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=440:sample_rate=48000:duration=8",
  "-filter:a",
  "volume=0.15,volume=0:enable=between(t\\,2\\,4)",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-shortest",
  "/tmp/vanta-input.mp4",
]);
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=220:sample_rate=48000:duration=8",
  "-c:a",
  "pcm_s16le",
  "/tmp/vanta-music.wav",
]);
ffmpeg([
  "-f",
  "lavfi",
  "-i",
  "color=c=orange:size=120x120",
  "-frames:v",
  "1",
  "/tmp/vanta-image.png",
]);

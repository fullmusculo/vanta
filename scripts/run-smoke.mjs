import { spawn } from "node:child_process";
const env = {
  ...process.env,
  DATA_DIR: process.env.SMOKE_DATA_DIR || "/tmp/vanta-smoke-data",
};
const api = spawn(process.execPath, ["--import", "tsx", "server/api.ts"], {
  env,
  stdio: ["ignore", "pipe", "inherit"],
});
let worker;
try {
  await new Promise((resolve, reject) => {
    api.stdout.on("data", (b) => {
      process.stdout.write(b);
      if (b.toString().includes("Editor:")) resolve();
    });
    api.on("exit", (c) => reject(Error("API exited " + c)));
  });
  worker = spawn(process.execPath, ["--import", "tsx", "server/worker.ts"], {
    env,
    stdio: "inherit",
  });
  const test = spawn(
    process.execPath,
    ["--import", "tsx", process.env.SMOKE_SCRIPT || "scripts/smoke.ts"],
    { env, stdio: "inherit" },
  );
  const code = await new Promise((r) => test.on("exit", r));
  if (code !== 0) process.exitCode = 1;
} finally {
  api.kill("SIGTERM");
  worker?.kill("SIGTERM");
}

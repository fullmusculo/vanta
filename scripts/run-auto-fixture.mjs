import { spawn } from "node:child_process";
import path from "node:path";
const child = spawn(process.execPath, ["scripts/run-smoke.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    OPENAI_API_KEY: "fixture-not-secret",
    OPENAI_DIRECTOR_MODEL: "fixture-model",
    SMOKE_DATA_DIR: "/tmp/vanta-autoedit-fixture",
    SMOKE_SCRIPT: "scripts/autoedit-smoke.ts",
    NODE_OPTIONS:
      (process.env.NODE_OPTIONS || "") +
      " --import=" +
      path.resolve("tests/provider-transport-fixture.mjs"),
  },
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

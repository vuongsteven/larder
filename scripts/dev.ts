// Run the API (restarting on change) and the Vite dev server together.
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["--watch", "server/index.ts"], { stdio: "inherit", env: { ...process.env, DATA_DIR: process.env.DATA_DIR ?? "./data-dev" } }),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => (stop(), process.exit(code ?? 0)));

import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8791;
const dataDir = join(tmpdir(), `larder-e2e-${process.pid}`);

export default defineConfig({
  testDir: "tests/e2e",
  // One server, one household: run tests in order so they don't trip over each other.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    storageState: "tests/e2e/.auth.json",
    trace: "off",
  },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 15 Pro"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `rm -rf ${dataDir} && DATA_DIR=${dataDir} PORT=${PORT} LARDER_BACKUP_KEEP=0 LARDER_BARCODE_LOOKUP=off LARDER_LOG_REQUESTS=0 node server/index.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});

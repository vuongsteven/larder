import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 8791;
const dataDir = join(tmpdir(), `larder-e2e-${process.pid}`);

// A self-signed certificate for the fake push service the push test runs: web-push
// only sends over https, and the server trusts this one through NODE_EXTRA_CA_CERTS.
// Workers inherit the env var, so they reuse the main process's certificate.
if (!process.env.LARDER_E2E_CERT_DIR) {
  const dir = mkdtempSync(join(tmpdir(), "larder-e2e-cert-"));
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
  ], { stdio: "ignore" });
  process.env.LARDER_E2E_CERT_DIR = dir;
}
const certDir = process.env.LARDER_E2E_CERT_DIR;
// Browser and server must agree on what "tomorrow" is.
const TZ = "America/Toronto";

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
    timezoneId: TZ,
    trace: "off",
  },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 15 Pro"] } },
    { name: "android-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `rm -rf ${dataDir} && DATA_DIR=${dataDir} PORT=${PORT} LARDER_BACKUP_KEEP=0 LARDER_BARCODE_LOOKUP=off LARDER_LOG_REQUESTS=0 node server/index.ts`,
    env: { TZ, NODE_EXTRA_CA_CERTS: join(certDir, "cert.pem") },
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});

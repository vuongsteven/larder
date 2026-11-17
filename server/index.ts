import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp, VERSION } from "./app.ts";
import { backup, newestBackupAge } from "./backup.ts";
import { loadConfig } from "./config.ts";
import { openDb } from "./db.ts";
import { ChangeBus } from "./events.ts";
import { runDailyReminders, webPushSender } from "./push.ts";
import { prune } from "./sync.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, "larder.db"));
const bus = new ChangeBus();
const pushSender = webPushSender(db, config.pushSubject);
const app = createApp({ db, config, bus, pushSender });

const backupDir = join(config.dataDir, "backups");
const intervalMs = config.backupIntervalHours * 3_600_000;

function maintenance() {
  try {
    prune(db);
    // Restarts shouldn't churn through the retained snapshots.
    if (config.backupKeep > 0 && newestBackupAge(backupDir) > intervalMs * 0.9) {
      const file = backup(db, backupDir, config.backupKeep);
      console.log(`[larder] backup written: ${file}`);
    }
  } catch (err) {
    console.error("[larder] maintenance failed", err);
  }
}
maintenance();
const timer = setInterval(maintenance, Math.min(intervalMs, 6 * 3_600_000));
timer.unref();

let remindersRunning = false;
async function reminders() {
  if (remindersRunning) return;
  remindersRunning = true;
  try {
    const { sent, failed } = await runDailyReminders(db, pushSender, new Date(), config.reminderTime);
    if (sent || failed) console.log(`[larder] expiry reminders: ${sent} sent, ${failed} failed`);
  } catch (err) {
    console.error("[larder] expiry reminders failed", err);
  } finally {
    remindersRunning = false;
  }
}
void reminders();
const reminderTimer = setInterval(reminders, 5 * 60_000);
reminderTimer.unref();

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[larder] v${VERSION} listening on http://${info.address}:${info.port} (data: ${config.dataDir})`);
});

function shutdown(signal: string) {
  console.log(`[larder] ${signal}, shutting down`);
  clearInterval(timer);
  clearInterval(reminderTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  // SSE streams keep connections open; don't wait on them forever.
  setTimeout(() => {
    db.close();
    process.exit(0);
  }, 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

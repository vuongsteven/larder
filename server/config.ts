import { resolve } from "node:path";

function bool(v: string | undefined, fallback: boolean) {
  if (v == null || v === "") return fallback;
  return ["1", "true", "on", "yes"].includes(v.toLowerCase());
}

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  production: boolean;
  barcodeLookup: boolean;
  backupKeep: number;
  backupIntervalHours: number;
  logRequests: boolean;
  /** Trust X-Forwarded-For from any peer (set when only a reverse proxy can reach the port). */
  trustProxy: boolean;
  /** Server-local "HH:MM" after which the day's expiry reminders go out. */
  reminderTime: string;
  /** VAPID contact for push services, a mailto: or https: URL. */
  pushSubject: string;
}

const DEFAULT_REMINDER_TIME = "08:00";

function hhmm(v: string | undefined) {
  if (!v) return DEFAULT_REMINDER_TIME;
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return v;
  console.warn(`[larder] LARDER_REMINDER_TIME "${v}" isn't HH:MM; using ${DEFAULT_REMINDER_TIME}`);
  return DEFAULT_REMINDER_TIME;
}

export function loadConfig(env = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    webDir: resolve(env.WEB_DIR ?? "./dist"),
    production: env.NODE_ENV === "production",
    barcodeLookup: bool(env.LARDER_BARCODE_LOOKUP, true),
    backupKeep: Number(env.LARDER_BACKUP_KEEP ?? 14),
    backupIntervalHours: Number(env.LARDER_BACKUP_INTERVAL_HOURS ?? 24),
    logRequests: bool(env.LARDER_LOG_REQUESTS, true),
    trustProxy: bool(env.LARDER_TRUST_PROXY, false),
    reminderTime: hhmm(env.LARDER_REMINDER_TIME),
    pushSubject: env.LARDER_PUSH_SUBJECT || "mailto:larder@example.com",
  };
}

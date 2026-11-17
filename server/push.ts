// Expiry reminders over Web Push: VAPID keys, the daily digest, and delivery.
import * as webpush from "web-push";
import type { Item, PushPayload } from "../shared/schema.ts";
import { type DB, getMeta, setMeta, tx } from "./db.ts";

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export type SendResult = "ok" | "gone" | "error";
export type PushSender = (sub: PushTarget, payload: PushPayload) => Promise<SendResult>;

const TAG = "larder-expiry"; // one notification per device: each day's replaces the last
const WINDOW_DAYS = 2;
const MAX_NAMES = 4;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** The server's calendar day, in the process time zone (TZ). */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Calendar arithmetic on YYYY-MM-DD in UTC, so no time zone or DST shift can move a day.
function utcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(iso: string, days: number): string {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string, today: string): string {
  if (iso === today) return "today";
  if (iso === addDays(today, 1)) return "tomorrow";
  return WEEKDAYS[utcDate(iso).getUTCDay()];
}

/** What expires from today to two days out, as one notification, or null if nothing does. */
export function buildDigest(items: Pick<Item, "name" | "expiresOn">[], today: string): PushPayload | null {
  const last = addDays(today, WINDOW_DAYS);
  const soon = items
    .filter((i): i is { name: string; expiresOn: string } => i.expiresOn != null && i.expiresOn >= today && i.expiresOn <= last)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name));
  if (soon.length === 0) return null;
  const names = soon.slice(0, MAX_NAMES).map((i) => `${i.name} (${dayLabel(i.expiresOn, today)})`);
  const more = soon.length - names.length;
  return {
    title: `${soon.length} ${soon.length === 1 ? "thing" : "things"} to use soon`,
    body: names.join(", ") + (more > 0 ? ` and ${more} more` : ""),
    url: "/stock?filter=expiring",
    tag: TAG,
  };
}

/** The server's VAPID key pair, created on first use and kept in meta. */
export function vapidKeys(db: DB): { publicKey: string; privateKey: string } {
  const publicKey = getMeta(db, "vapid_public");
  const privateKey = getMeta(db, "vapid_private");
  if (publicKey && privateKey) return { publicKey, privateKey };
  const keys = webpush.generateVAPIDKeys();
  tx(db, () => {
    setMeta(db, "vapid_public", keys.publicKey);
    setMeta(db, "vapid_private", keys.privateKey);
  });
  return keys;
}

export function webPushSender(db: DB, subject: string): PushSender {
  return async (sub, payload) => {
    const { publicKey, privateKey } = vapidKeys(db);
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        vapidDetails: { subject, publicKey, privateKey },
        TTL: 12 * 3600,
        timeout: 10_000,
      });
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      console.warn(`[larder] push to ${new URL(sub.endpoint).host} failed: ${status ?? (err as Error).message}`);
      return "error";
    }
  };
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Send one notification; a subscription the push service says is gone is removed. */
async function deliver(db: DB, send: PushSender, row: SubRow, payload: PushPayload): Promise<SendResult> {
  const result = await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
  if (result === "gone") db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(row.endpoint);
  return result;
}

function datedItems(db: DB): Pick<Item, "name" | "expiresOn">[] {
  return db
    .prepare(
      `SELECT json_extract(data, '$.name') AS name, json_extract(data, '$.expiresOn') AS expiresOn
       FROM records WHERE tbl = 'items' AND deleted = 0 AND json_extract(data, '$.expiresOn') IS NOT NULL`,
    )
    .all() as unknown as Pick<Item, "name" | "expiresOn">[];
}

const tally = (results: SendResult[]) => ({
  sent: results.filter((r) => r === "ok").length,
  failed: results.filter((r) => r !== "ok").length,
});

/**
 * Once the local clock passes reminderTime, send today's digest to every device
 * not yet reminded today. Safe to call as often as you like: a device is marked
 * as soon as its send succeeds, so reruns and restarts only retry the rest.
 */
export async function runDailyReminders(db: DB, send: PushSender, now: Date, reminderTime: string) {
  if (`${pad(now.getHours())}:${pad(now.getMinutes())}` < reminderTime) return tally([]);
  const today = localDay(now);
  const due = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE last_sent_day IS NOT ?").all(today) as unknown as SubRow[];
  if (due.length === 0) return tally([]);
  const markSent = db.prepare("UPDATE push_subscriptions SET last_sent_day = ? WHERE endpoint = ?");
  const digest = buildDigest(datedItems(db), today);
  if (!digest) {
    for (const row of due) markSent.run(today, row.endpoint);
    return tally([]);
  }
  const results = await Promise.all(
    due.map(async (row) => {
      const result = await deliver(db, send, row, digest);
      if (result === "ok") markSent.run(today, row.endpoint);
      return result;
    }),
  );
  return tally(results);
}

/** Send the digest to one user's devices right now, so they can see what reminders look like. */
export async function sendTestReminder(db: DB, send: PushSender, userId: string, today: string) {
  const rows = db.prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId) as unknown as SubRow[];
  const payload = buildDigest(datedItems(db), today) ?? {
    title: "Expiry reminders are on",
    body: `Nothing expires in the next ${WINDOW_DAYS} days. You'll hear from Larder when something does.`,
    url: "/",
    tag: TAG,
  };
  return tally(await Promise.all(rows.map((row) => deliver(db, send, row, payload))));
}

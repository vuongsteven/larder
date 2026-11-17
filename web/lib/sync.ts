// Background sync: push the outbox, pull everything newer than our cursor,
// replay still-pending local ops on top. Triggered by local writes, coming back
// online or to the foreground, a server "changed" event, and a slow timer.
import type { Op, Row, SyncResponse } from "../../shared/schema.ts";
import { ApiError, api } from "./api.ts";
import { db, getMeta, setMeta, type OutboxEntry } from "./db.ts";
import { applyLocally, onLocalWrite } from "./store.ts";
import { uid } from "./util.ts";

export type SyncState = "idle" | "syncing" | "offline" | "error" | "signed-out";

export interface SyncStatus {
  state: SyncState;
  lastSyncAt: number | null;
  error: string | null;
  live: boolean; // live-update channel connected
}

const BATCH = 200;
const POLL_MS = 60_000;

class SyncEngine {
  status: SyncStatus = { state: "idle", lastSyncAt: null, error: null, live: false };
  private listeners = new Set<() => void>();
  private running = false;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private failures = 0;
  private clientId = "";
  private events: EventSource | null = null;
  private started = false;
  private generation = 0;
  private cleanup: (() => void)[] = [];
  onRejected: (reason: string) => void = () => {};
  onSignedOut: () => void = () => {};

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getStatus = () => this.status;

  private set(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((l) => l());
  }

  async start() {
    if (this.started) return;
    this.started = true;
    const gen = ++this.generation;
    const clientId = (await getMeta<string>("clientId")) ?? uid();
    await setMeta("clientId", clientId);
    const lastSyncAt = (await getMeta<number>("lastSyncAt")) ?? null;
    // stop() ran (or another start began) while we were awaiting: don't attach twice.
    if (gen !== this.generation || !this.started) return;
    this.clientId = clientId;
    this.set({ lastSyncAt });

    const onOnline = () => this.schedule(0);
    const onOffline = () => this.set({ state: "offline" });
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        this.schedule(0);
        this.openEvents();
      } else {
        this.closeEvents();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    this.poll = setInterval(() => document.visibilityState === "visible" && this.schedule(0), POLL_MS);
    this.cleanup = [
      onLocalWrite(() => this.schedule(300)),
      () => window.removeEventListener("online", onOnline),
      () => window.removeEventListener("offline", onOffline),
      () => document.removeEventListener("visibilitychange", onVisible),
      () => clearInterval(this.poll),
    ];
    this.schedule(0);
    this.openEvents();
  }

  stop() {
    this.started = false;
    this.generation++;
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    clearTimeout(this.timer);
    this.closeEvents();
  }

  schedule(delayMs: number) {
    if (!this.started) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delayMs);
  }

  /** Sync now and resolve when done (used by "Sync now" and tests). */
  async syncNow() {
    clearTimeout(this.timer);
    await this.run();
  }

  private async run() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.set({ state: "syncing" });
    try {
      do {
        this.again = false;
        let more = true;
        while (more) more = await this.round();
      } while (this.again);
      this.failures = 0;
      const now = Date.now();
      await setMeta("lastSyncAt", now);
      this.set({ state: "idle", error: null, lastSyncAt: now });
      if (!this.events) this.openEvents();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.set({ state: "signed-out", error: null });
        this.closeEvents();
        this.onSignedOut();
      } else {
        const offline = !(err instanceof ApiError) || err.status === 0 || err.status >= 502;
        this.set({ state: offline ? "offline" : "error", error: err instanceof Error ? err.message : String(err) });
        // Retry with capped exponential backoff: 2s, 4s, 8s … 60s.
        this.failures++;
        this.schedule(Math.min(60_000, 1000 * 2 ** this.failures));
      }
    } finally {
      this.running = false;
    }
  }

  /** One push/pull exchange. Returns true if another round is needed. */
  private async round(): Promise<boolean> {
    const batch = await db.outbox.orderBy("seq").limit(BATCH).toArray();
    const cursor = (await getMeta<number>("cursor")) ?? 0;
    const res = await api<SyncResponse>("/api/sync", {
      body: { clientId: this.clientId, cursor, ops: batch.map((b) => b.op) },
      timeoutMs: 30_000,
    });
    await this.apply(res, batch);
    for (const r of res.rejected) this.onRejected(r.reason);
    return res.more || batch.length === BATCH || res.rejected.length > 0;
  }

  private async apply(res: SyncResponse, sent: OutboxEntry[]) {
    const done = new Set([...res.applied, ...res.rejected.map((r) => r.opId)]);
    await db.transaction("rw", [...db.entityTables, db.outbox, db.meta], async () => {
      await db.outbox.bulkDelete(sent.filter((e) => done.has(e.op.opId)).map((e) => e.seq!));
      if (res.reset) await Promise.all(db.entityTables.map((t) => t.clear()));

      const touched = new Set<string>();
      for (const c of res.changes) {
        const table = db.entity(c.table);
        if (c.deleted) await table.delete(c.row.id);
        else await table.put(c.row as unknown as Row);
        touched.add(`${c.table}:${c.row.id}`);
      }

      // Ops the server hasn't seen yet win locally until they're pushed.
      const pending: Op[] = (await db.outbox.orderBy("seq").toArray()).map((e) => e.op);
      for (const op of pending) {
        if (res.reset || touched.has(`${op.table}:${op.id}`)) await applyLocally(op);
      }
      // A rejected op left a local change the server won't accept: re-pull everything to undo it.
      await setMeta("cursor", res.rejected.length > 0 ? 0 : res.cursor);
    });
  }

  private openEvents() {
    if (this.events || !this.started || typeof EventSource === "undefined") return;
    if (document.visibilityState !== "visible") return;
    const es = new EventSource(`/api/events?clientId=${encodeURIComponent(this.clientId)}`);
    es.addEventListener("hello", () => this.set({ live: true }));
    es.addEventListener("changed", () => this.schedule(50));
    es.onerror = () => {
      this.set({ live: false });
      // CLOSED means the server refused (e.g. signed out); the browser retries otherwise.
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        this.events = null;
      }
    };
    this.events = es;
  }

  private closeEvents() {
    this.events?.close();
    this.events = null;
    this.set({ live: false });
  }
}

export const syncEngine = new SyncEngine();

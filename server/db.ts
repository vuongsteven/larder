import { DatabaseSync } from "node:sqlite";

export type DB = DatabaseSync;

// Each entry runs once, in order; PRAGMA user_version records progress.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- All household data lives here as JSON documents, one row per entity.
  -- version is a global change sequence that clients pull from.
  CREATE TABLE records (
    tbl TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tbl, id)
  ) WITHOUT ROWID;
  CREATE INDEX records_version ON records(version);

  -- Remembers applied client ops so a retried sync never applies one twice.
  CREATE TABLE applied_ops (op_id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
  CREATE INDEX applied_ops_at ON applied_ops(applied_at);

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE barcode_cache (barcode TEXT PRIMARY KEY, data TEXT NOT NULL, fetched_at INTEGER NOT NULL);
  `,
  `
  -- One row per device that turned on expiry reminders. Server-only, never synced.
  -- last_sent_day (server-local YYYY-MM-DD) makes the daily reminder run once per day.
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_sent_day TEXT,
    user_agent TEXT
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
  `,
];

export function openDb(file: string): DB {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(db);
  return db;
}

function migrate(db: DB) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Run fn in a write transaction. node:sqlite is synchronous, so fn must be too. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getMeta(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setMeta(db: DB, key: string, value: string | number) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

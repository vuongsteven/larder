// The sync engine. Clients push field-level patches and pull every record
// whose version is newer than their cursor, in one transaction.
import { randomUUID } from "node:crypto";
import { ENTITY_SCHEMAS, type Op, type SyncRequest, type SyncResponse, type TableName } from "../shared/schema.ts";
import { type DB, getMeta, setMeta, tx } from "./db.ts";

export const PAGE_SIZE = 1000;
const OP_RETENTION_MS = 30 * 86_400_000;
const TOMBSTONE_RETENTION_MS = 90 * 86_400_000;

interface RecordRow {
  tbl: TableName;
  id: string;
  data: string;
  version: number;
  updated_at: number;
  updated_by: string | null;
  deleted: number;
}

function nextSeq(db: DB): number {
  const seq = Number(getMeta(db, "seq") ?? 0) + 1;
  setMeta(db, "seq", seq);
  return seq;
}

export function currentSeq(db: DB): number {
  return Number(getMeta(db, "seq") ?? 0);
}

type ApplyResult = { ok: true; changed: boolean } | { ok: false; reason: string };

/** Apply one op. Must run inside a transaction. */
function applyOp(db: DB, op: Op, userId: string | null, now: number): ApplyResult {
  const existing = db.prepare("SELECT data, deleted FROM records WHERE tbl = ? AND id = ?").get(op.table, op.id) as
    | Pick<RecordRow, "data" | "deleted">
    | undefined;

  if (op.delete) {
    // Deleting something the server never saw is a no-op; deleting twice is too.
    if (!existing || existing.deleted) return { ok: true, changed: false };
    db.prepare("UPDATE records SET deleted = 1, version = ?, updated_at = ?, updated_by = ? WHERE tbl = ? AND id = ?").run(
      nextSeq(db), now, userId, op.table, op.id,
    );
    return { ok: true, changed: true };
  }

  if (!op.patch) return { ok: false, reason: "Op has neither patch nor delete" };
  // Delete wins: an edit that raced a delete from another device is dropped.
  if (existing?.deleted) return { ok: true, changed: false };

  const base = existing ? (JSON.parse(existing.data) as Record<string, unknown>) : {};
  const parsed = ENTITY_SCHEMAS[op.table].safeParse({ ...base, ...op.patch });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, reason: `${issue.path.join(".") || op.table}: ${issue.message}` };
  }
  const data = JSON.stringify(parsed.data);
  if (existing && existing.data === data) return { ok: true, changed: false };

  db.prepare(
    `INSERT INTO records (tbl, id, data, version, updated_at, updated_by, deleted) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(tbl, id) DO UPDATE SET data = excluded.data, version = excluded.version,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(op.table, op.id, data, nextSeq(db), now, userId);
  return { ok: true, changed: true };
}

export function sync(db: DB, userId: string, req: SyncRequest): SyncResponse & { changed: boolean } {
  return tx(db, () => {
    const now = Date.now();
    const applied: string[] = [];
    const rejected: SyncResponse["rejected"] = [];
    let changed = false;
    const seen = db.prepare("SELECT 1 FROM applied_ops WHERE op_id = ?");
    const remember = db.prepare("INSERT INTO applied_ops (op_id, applied_at) VALUES (?, ?)");

    for (const op of req.ops) {
      if (seen.get(op.opId)) {
        applied.push(op.opId);
        continue;
      }
      const result = applyOp(db, op, userId, now);
      if (result.ok) {
        applied.push(op.opId);
        changed ||= result.changed;
        remember.run(op.opId, now);
      } else {
        rejected.push({ opId: op.opId, reason: result.reason });
      }
    }

    const seq = currentSeq(db);
    const horizon = Number(getMeta(db, "horizon") ?? 0);
    // A cursor ahead of the server means the database was restored from a
    // backup; one behind the horizon may have missed pruned deletions.
    const reset = req.cursor > seq || (req.cursor > 0 && req.cursor < horizon);
    const from = reset ? 0 : req.cursor;

    const rows = db
      .prepare(
        `SELECT tbl, id, data, version, updated_at, updated_by, deleted FROM records
         WHERE version > ? ${from === 0 ? "AND deleted = 0" : ""} ORDER BY version LIMIT ?`,
      )
      .all(from, PAGE_SIZE + 1) as unknown as RecordRow[];
    const more = rows.length > PAGE_SIZE;
    if (more) rows.pop();

    return {
      cursor: more ? rows[rows.length - 1].version : seq,
      reset: reset || req.cursor === 0,
      more,
      applied,
      rejected,
      changed,
      changes: rows.map((r) => ({
        table: r.tbl,
        deleted: r.deleted === 1,
        row: { ...(JSON.parse(r.data) as Record<string, unknown>), id: r.id, _v: r.version, _at: r.updated_at, _by: r.updated_by },
      })),
    };
  });
}

/** Write records directly (server-side seeding). */
export function serverWrite(db: DB, table: TableName, data: Record<string, unknown>, userId: string | null): string {
  const id = randomUUID();
  const result = applyOp(db, { opId: id, table, id, patch: data }, userId, Date.now());
  if (!result.ok) throw new Error(result.reason);
  return id;
}

/** Drop old op receipts and tombstones. Clients older than the horizon do a full reset. */
export function prune(db: DB, now = Date.now()) {
  tx(db, () => {
    db.prepare("DELETE FROM applied_ops WHERE applied_at < ?").run(now - OP_RETENTION_MS);
    const cutoff = now - TOMBSTONE_RETENTION_MS;
    const top = db.prepare("SELECT MAX(version) AS v FROM records WHERE deleted = 1 AND updated_at < ?").get(cutoff) as { v: number | null };
    if (top.v != null) {
      db.prepare("DELETE FROM records WHERE deleted = 1 AND updated_at < ?").run(cutoff);
      // A client whose cursor is at or past top.v already saw these deletions.
      setMeta(db, "horizon", Math.max(top.v, Number(getMeta(db, "horizon") ?? 0)));
    }
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  });
}

export function exportAll(db: DB) {
  const rows = db.prepare("SELECT tbl, id, data, updated_at FROM records WHERE deleted = 0 ORDER BY tbl, updated_at").all() as unknown as RecordRow[];
  const out: Record<string, unknown[]> = {};
  for (const r of rows) (out[r.tbl] ??= []).push({ id: r.id, ...JSON.parse(r.data), updatedAt: new Date(r.updated_at).toISOString() });
  return out;
}

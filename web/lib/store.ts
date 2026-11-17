// Local writes. Each write updates IndexedDB and queues an op in the outbox
// in one transaction, so the UI changes instantly and the server catches up
// whenever the connection allows.
import { ENTITY_SCHEMAS, type EntityMap, type Op, type Row, type TableName } from "../../shared/schema.ts";
import { db } from "./db.ts";
import { uid } from "./util.ts";

const writeListeners = new Set<() => void>();
export function onLocalWrite(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

export function fields<T extends TableName>(row: Row<T>): EntityMap[T] {
  const { id: _id, _v, _at, _by, ...rest } = row as Row & Record<string, unknown>;
  return rest as unknown as EntityMap[T];
}

/** Apply an op to the local tables (used for new writes and when replaying pending ops after a pull). */
export async function applyLocally(op: Op): Promise<void> {
  const table = db.entity(op.table);
  if (op.delete) {
    await table.delete(op.id);
    return;
  }
  const existing = await table.get(op.id);
  const base = existing ?? ({ id: op.id, _v: 0, _at: Date.now(), _by: null } as unknown as Row);
  await table.put({ ...base, ...op.patch, id: op.id } as Row);
}

/** Run several writes atomically. Nested calls join the outer transaction. */
export async function transact<T>(fn: () => Promise<T>): Promise<T> {
  const result = await db.transaction("rw", [...db.entityTables, db.outbox], fn);
  writeListeners.forEach((l) => l());
  return result;
}

async function enqueue(op: Op) {
  await applyLocally(op);
  await db.outbox.add({ op, createdAt: Date.now() });
}

/**
 * Create (id = null) or patch a record. Validates with the shared schema, so a
 * bad value throws here instead of being rejected by the server later.
 * Returns the record id.
 */
export function save<T extends TableName>(table: T, id: string | null, patch: Partial<EntityMap[T]>): Promise<string> {
  return transact(async () => {
    const schema = ENTITY_SCHEMAS[table];
    if (id == null) {
      const data = schema.parse(patch) as Record<string, unknown>;
      const newId = uid();
      await enqueue({ opId: uid(), table, id: newId, patch: data });
      return newId;
    }
    const existing = await db.entity(table).get(id);
    if (!existing) return id; // deleted elsewhere meanwhile; nothing to edit
    const current = fields(existing) as Record<string, unknown>;
    const merged = schema.parse({ ...current, ...patch }) as Record<string, unknown>;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (key in merged && JSON.stringify(merged[key]) !== JSON.stringify(current[key])) changed[key] = merged[key];
    }
    if (Object.keys(changed).length > 0) await enqueue({ opId: uid(), table, id, patch: changed });
    return id;
  });
}

export function remove(table: TableName, id: string): Promise<void> {
  return transact(async () => {
    if (!(await db.entity(table).get(id))) return;
    await enqueue({ opId: uid(), table, id, delete: true });
  });
}

/** Wipe everything local (sign-out on a shared device, or a manual reset). */
export async function clearLocalData() {
  await db.transaction("rw", [...db.entityTables, db.outbox, db.meta], async () => {
    await Promise.all([...db.entityTables, db.outbox, db.meta].map((t) => t.clear()));
  });
  writeListeners.forEach((l) => l());
}

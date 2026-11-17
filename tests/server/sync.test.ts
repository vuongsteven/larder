import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMeta, setMeta } from "../../server/db.ts";
import { PAGE_SIZE, prune } from "../../server/sync.ts";
import { client, ITEM, makeServer, opId } from "./helpers.ts";

let srv: ReturnType<typeof makeServer>;
let a: ReturnType<typeof client>;

beforeEach(async () => {
  srv = makeServer();
  a = client(srv.app);
  await a.post("/api/auth/setup", { username: "alex", name: "Alex", password: "password123" });
});
afterEach(() => srv.close());

const sync = (c: ReturnType<typeof client>, cursor: number, ops: unknown[] = [], clientId = "client-aaaa") =>
  c.post("/api/sync", { clientId, cursor, ops });

describe("sync", () => {
  it("seeds the three default locations on setup and returns them on first sync", async () => {
    const res = await sync(a, 0);
    expect(res.status).toBe(200);
    expect(res.json.reset).toBe(true);
    expect(res.json.changes.map((c: any) => c.row.name)).toEqual(["Pantry", "Fridge", "Freezer"]);
    expect(res.json.cursor).toBe(3);
  });

  it("creates with schema defaults and merges later patches field by field", async () => {
    const r1 = await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: ITEM }]);
    const created = r1.json.changes.find((c: any) => c.row.id === "i1").row;
    expect(created).toMatchObject({ name: "Milk", quantity: 1, unit: "", category: "Other", expiresOn: null, _by: expect.any(String) });

    // Two devices edit different fields of the same item: both changes survive.
    await sync(a, r1.json.cursor, [{ opId: opId(), table: "items", id: "i1", patch: { quantity: 3 } }], "phone-aaaa");
    const r3 = await sync(a, r1.json.cursor, [{ opId: opId(), table: "items", id: "i1", patch: { expiresOn: "2026-02-01" } }], "tablet-aaa");
    const row = r3.json.changes.filter((c: any) => c.row.id === "i1").at(-1).row;
    expect(row).toMatchObject({ quantity: 3, expiresOn: "2026-02-01", name: "Milk" });
  });

  it("only returns changes newer than the cursor", async () => {
    const r1 = await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: ITEM }]);
    const r2 = await sync(a, r1.json.cursor);
    expect(r2.json.changes).toEqual([]);
    expect(r2.json.reset).toBe(false);
  });

  it("rejects invalid records with a reason and leaves the store unchanged", async () => {
    const bad = opId();
    const r = await sync(a, 0, [
      { opId: bad, table: "items", id: "i1", patch: { name: "", locationId: "x", addedOn: "2026-01-01" } },
      { opId: opId(), table: "items", id: "i2", patch: { ...ITEM, expiresOn: "next tuesday" } },
    ]);
    expect(r.json.applied).toEqual([]);
    expect(r.json.rejected).toHaveLength(2);
    expect(r.json.rejected[0]).toMatchObject({ opId: bad, reason: expect.stringContaining("name") });
    expect(r.json.changes.some((c: any) => c.table === "items")).toBe(false);
  });

  it("strips unknown fields instead of storing them", async () => {
    const r = await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: { ...ITEM, evil: "<script>", _v: 999 } }]);
    const row = r.json.changes.find((c: any) => c.row.id === "i1").row;
    expect(row.evil).toBeUndefined();
    expect(row._v).not.toBe(999);
  });

  it("applies a retried op only once", async () => {
    const op = { opId: opId(), table: "items", id: "i1", patch: ITEM };
    const r1 = await sync(a, 0, [op]);
    // A later edit from another device, then the first device retries its original op.
    await sync(a, r1.json.cursor, [{ opId: opId(), table: "items", id: "i1", patch: { name: "Oat milk" } }]);
    const r3 = await sync(a, 0, [op]);
    expect(r3.json.applied).toEqual([op.opId]);
    expect(r3.json.changes.find((c: any) => c.row.id === "i1").row.name).toBe("Oat milk");
  });

  it("treats delete as final: a racing edit does not resurrect the record", async () => {
    const r1 = await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: ITEM }]);
    const r2 = await sync(a, r1.json.cursor, [{ opId: opId(), table: "items", id: "i1", delete: true }]);
    expect(r2.json.changes).toEqual([{ table: "items", deleted: true, row: expect.objectContaining({ id: "i1" }) }]);
    const r3 = await sync(a, r2.json.cursor, [{ opId: opId(), table: "items", id: "i1", patch: { quantity: 5 } }]);
    expect(r3.json.applied).toHaveLength(1);
    expect(r3.json.changes).toEqual([]);
    // A fresh device never sees it.
    const fresh = await sync(a, 0);
    expect(fresh.json.changes.some((c: any) => c.row.id === "i1")).toBe(false);
  });

  it("pages large pulls", async () => {
    const ops = Array.from({ length: 500 }, (_, i) => ({ opId: opId(), table: "items", id: `i${i}`, patch: { ...ITEM, name: `Item ${i}` } }));
    await sync(a, 0, ops);
    await sync(a, 0, ops.map((o) => ({ ...o, opId: opId(), id: `${o.id}b` })));
    await sync(a, 0, ops.map((o) => ({ ...o, opId: opId(), id: `${o.id}c` })));
    let cursor = 0;
    let seen = 0;
    let pages = 0;
    for (;;) {
      const r = await sync(a, cursor);
      seen += r.json.changes.length;
      cursor = r.json.cursor;
      pages++;
      if (!r.json.more) break;
    }
    expect(PAGE_SIZE).toBe(1000);
    expect(pages).toBe(2);
    expect(seen).toBe(1503);
  });

  it("tells a client to reset when its cursor is ahead of the server (restored backup)", async () => {
    const r = await sync(a, 9999);
    expect(r.json.reset).toBe(true);
    expect(r.json.changes).toHaveLength(3);
  });

  it("prunes old tombstones and makes clients behind the horizon reset", async () => {
    const r1 = await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: ITEM }]);
    const r2 = await sync(a, r1.json.cursor, [{ opId: opId(), table: "items", id: "i1", delete: true }]);
    prune(srv.db, Date.now() + 100 * 86_400_000);
    expect(Number(getMeta(srv.db, "horizon"))).toBe(r2.json.cursor);
    const stale = await sync(a, r1.json.cursor);
    expect(stale.json.reset).toBe(true);
    const current = await sync(a, r2.json.cursor);
    expect(current.json.reset).toBe(false);
  });

  it("notifies other clients, not the sender, when data changes", async () => {
    const events: any[] = [];
    srv.bus.on((e) => events.push(e));
    await sync(a, 0, [], "quiet-client");
    expect(events).toHaveLength(0);
    await sync(a, 0, [{ opId: opId(), table: "tasks", id: "t1", patch: { title: "Defrost" } }], "busy-client");
    expect(events).toEqual([{ seq: 4, clientId: "busy-client" }]);
  });

  it("validates the request shape", async () => {
    expect((await a.post("/api/sync", { clientId: "x", cursor: 0, ops: [] })).status).toBe(400);
    expect((await a.post("/api/sync", { clientId: "client-aaaa", cursor: 0, ops: [{ opId: "op-1234567", table: "users", id: "u", patch: {} }] })).status).toBe(400);
  });

  it("keeps the change sequence in the meta table", async () => {
    await sync(a, 0, [{ opId: opId(), table: "items", id: "i1", patch: ITEM }]);
    expect(getMeta(srv.db, "seq")).toBe("4");
    setMeta(srv.db, "seq", 4);
  });
});

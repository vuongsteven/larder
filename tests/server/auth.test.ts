import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backup } from "../../server/backup.ts";
import { client, makeServer } from "./helpers.ts";

let srv: ReturnType<typeof makeServer>;
beforeEach(() => {
  srv = makeServer();
});
afterEach(() => srv.close());

const owner = { username: "Alex", name: "Alex", password: "password123" };

describe("setup and sessions", () => {
  it("allows setup exactly once and signs the owner in", async () => {
    const a = client(srv.app);
    expect((await a.get("/api/auth/status")).json).toEqual({ setupRequired: true, user: null });
    const res = await a.post("/api/auth/setup", owner);
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ username: "alex", role: "owner" });
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect((await a.get("/api/auth/status")).json.user.username).toBe("alex");

    const b = client(srv.app);
    expect((await b.post("/api/auth/setup", { ...owner, username: "mallory" })).status).toBe(409);
  });

  it("rejects weak input", async () => {
    const a = client(srv.app);
    expect((await a.post("/api/auth/setup", { ...owner, password: "short" })).status).toBe(400);
    expect((await a.post("/api/auth/setup", { ...owner, username: "bad name!" })).status).toBe(400);
  });

  it("logs in case-insensitively and out again", async () => {
    await client(srv.app).post("/api/auth/setup", owner);
    const b = client(srv.app);
    expect((await b.post("/api/auth/login", { username: "ALEX", password: "wrong-password" })).status).toBe(401);
    expect((await b.post("/api/auth/login", { username: "ALEX", password: "password123" })).status).toBe(200);
    expect((await b.get("/api/users")).status).toBe(200);
    await b.post("/api/auth/logout");
    expect((await b.get("/api/users")).status).toBe(401);
  });

  it("throttles repeated failed logins", async () => {
    await client(srv.app).post("/api/auth/setup", owner);
    const b = client(srv.app);
    for (let i = 0; i < 10; i++) await b.post("/api/auth/login", { username: "alex", password: "nope-nope" });
    const res = await b.post("/api/auth/login", { username: "alex", password: "password123" });
    expect(res.status).toBe(429);
  });

  it("requires a session for data and the X-Larder header for writes", async () => {
    const anon = client(srv.app);
    expect((await anon.post("/api/sync", { clientId: "client-aaaa", cursor: 0, ops: [] })).status).toBe(401);
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    // Simulate a cross-site form post: no custom header.
    const res = await srv.app.request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: a.cookie },
      body: JSON.stringify({ clientId: "client-aaaa", cursor: 0, ops: [] }),
    });
    expect(res.status).toBe(403);
  });

  it("changing the password signs out other devices", async () => {
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    const b = client(srv.app);
    await b.post("/api/auth/login", { username: "alex", password: "password123" });
    expect((await a.post("/api/auth/password", { current: "password123", next: "new-password-1" })).status).toBe(200);
    expect((await a.get("/api/users")).status).toBe(200);
    expect((await b.get("/api/users")).status).toBe(401);
  });

  it("sets security headers", async () => {
    const res = await srv.app.request("/api/health");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("household members", () => {
  it("lets the owner add and remove members, and members share data", async () => {
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    const add = await a.post("/api/users", { username: "sam", name: "Sam", password: "password456" });
    expect(add.status).toBe(201);
    expect((await a.post("/api/users", { username: "sam", name: "Sam 2", password: "password456" })).status).toBe(409);

    const s = client(srv.app);
    await s.post("/api/auth/login", { username: "sam", password: "password456" });
    const synced = await s.post("/api/sync", { clientId: "sam-phone-1", cursor: 0, ops: [] });
    expect(synced.json.changes).toHaveLength(3);
    // Members can't manage members.
    expect((await s.post("/api/users", { username: "eve", name: "Eve", password: "password789" })).status).toBe(403);
    expect((await s.get("/api/backup")).status).toBe(403);

    expect((await a.del(`/api/users/${add.json.user.id}`)).status).toBe(200);
    expect((await s.get("/api/users")).status).toBe(401);
  });

  it("does not let the owner remove themselves", async () => {
    const a = client(srv.app);
    const me = await a.post("/api/auth/setup", owner);
    expect((await a.del(`/api/users/${me.json.user.id}`)).status).toBe(400);
  });
});

describe("barcode lookup", () => {
  it("maps Open Food Facts data and caches it", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        status: 1,
        product: { product_name: "Greek Style Yogurt", brands: "Farm, Other", quantity: "500 g", categories_tags: ["en:dairies", "en:yogurts"] },
      }),
    );
    srv.close();
    srv = makeServer({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    const r1 = await a.get("/api/lookup/5000112637922");
    expect(r1.json).toEqual({ barcode: "5000112637922", found: true, name: "Greek Style Yogurt", brand: "Farm", category: "Dairy & Eggs", quantityText: "500 g" });
    await a.get("/api/lookup/5000112637922");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await a.get("/api/lookup/not-a-code")).status).toBe(400);
  });

  it("reports upstream failure without caching it", async () => {
    const fetchImpl = vi.fn(async () => new Response("down", { status: 503 }));
    srv.close();
    srv = makeServer({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    expect((await a.get("/api/lookup/5000112637922")).status).toBe(502);
    await a.get("/api/lookup/5000112637922");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("can be switched off", async () => {
    srv.close();
    srv = makeServer({ barcodeLookup: false });
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    expect((await a.get("/api/lookup/5000112637922")).json).toMatchObject({ found: false, disabled: true });
  });
});

describe("backups and export", () => {
  it("writes snapshots and keeps only the newest N", () => {
    const dir = join(srv.dir, "backups");
    for (let i = 0; i < 3; i++) backup(srv.db, dir, 2);
    // Same-second names overwrite; either way never more than `keep`.
    expect(readdirSync(dir).length).toBeLessThanOrEqual(2);
    expect(readdirSync(dir).length).toBeGreaterThanOrEqual(1);
  });

  it("exports live records only", async () => {
    const a = client(srv.app);
    await a.post("/api/auth/setup", owner);
    const res = await a.get("/api/export");
    expect(res.headers.get("content-disposition")).toMatch(/attachment/);
    expect(res.json.data.locations).toHaveLength(3);
  });
});

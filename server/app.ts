import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { z } from "zod";
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  setupSchema,
  syncRequestSchema,
  type AuthStatus,
  type PublicUser,
} from "../shared/schema.ts";
import {
  LoginLimiter,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  deleteSession,
  findUser,
  findUserByUsername,
  getDummyHash,
  hashPassword,
  insertUser,
  insertUserHashed,
  listUsers,
  sessionUser,
  toPublic,
  userCount,
  verifyPassword,
} from "./auth.ts";
import type { Config } from "./config.ts";
import { type DB, tx } from "./db.ts";
import type { ChangeBus } from "./events.ts";
import { lookupBarcode } from "./lookup.ts";
import { currentSeq, exportAll, serverWrite, sync } from "./sync.ts";

type Env = { Variables: { user: PublicUser } };

export interface AppDeps {
  db: DB;
  config: Config;
  bus: ChangeBus;
  fetchImpl?: typeof fetch;
}

export const VERSION = "1.0.0";

async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HTTPException(400, { message: `${issue.path.join(".") || "body"}: ${issue.message}` });
  }
  return parsed.data;
}

/**
 * The client's address. Behind a local reverse proxy (tailscale serve, Caddy) the
 * socket peer is loopback, so take the forwarded address in that case only.
 */
function clientIp(c: Context, trustProxy: boolean): string {
  let peer = "unknown";
  try {
    peer = getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // Not running on a Node socket (tests).
  }
  const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return (loopback || trustProxy) && forwarded ? forwarded : peer;
}

function isHttps(c: Context) {
  return c.req.url.startsWith("https:") || c.req.header("x-forwarded-proto") === "https";
}

function startSession(c: Context, db: DB, userId: string) {
  const token = createSession(db, userId, c.req.header("user-agent"));
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttps(c),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function createApp({ db, config, bus, fetchImpl }: AppDeps) {
  const app = new Hono<Env>();
  // Per account, and a looser per-address cap so one device can't lock out the household.
  const userLimiter = new LoginLimiter(10);
  const ipLimiter = new LoginLimiter(30);

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const api = new Hono<Env>();
  if (config.logRequests) {
    api.use("*", async (c, next) => {
      const start = performance.now();
      await next();
      if (c.req.path !== "/api/events") console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`);
    });
  }
  api.use("*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    // CSRF guard: a cross-site form or fetch cannot set a custom header without
    // a CORS preflight, which this server never approves.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-larder") !== "1") {
      throw new HTTPException(403, { message: "Missing X-Larder header" });
    }
    await next();
  });

  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const user = token ? sessionUser(db, token) : null;
    if (!user) throw new HTTPException(401, { message: "Not signed in" });
    c.set("user", user);
    await next();
  };
  const ownerOnly: MiddlewareHandler<Env> = async (c, next) => {
    if (c.get("user").role !== "owner") throw new HTTPException(403, { message: "Only the household owner can do that" });
    await next();
  };

  api.get("/health", (c) => c.json({ ok: true, version: VERSION }));

  api.get("/auth/status", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const status: AuthStatus = { setupRequired: userCount(db) === 0, user: token ? sessionUser(db, token) : null };
    return c.json(status);
  });

  api.post("/auth/setup", async (c) => {
    const input = await body(c, setupSchema);
    if (userCount(db) > 0) throw new HTTPException(409, { message: "Larder is already set up" });
    const hash = await hashPassword(input.password);
    const user = tx(db, () => {
      // Re-check inside the transaction in case two setups raced.
      if (userCount(db) > 0) throw new HTTPException(409, { message: "Larder is already set up" });
      const user = insertUserHashed(db, { username: input.username, name: input.name, hash, role: "owner" });
      serverWrite(db, "locations", { name: "Pantry", kind: "pantry", sort: 0 }, user.id);
      serverWrite(db, "locations", { name: "Fridge", kind: "fridge", sort: 1 }, user.id);
      serverWrite(db, "locations", { name: "Freezer", kind: "freezer", sort: 2 }, user.id);
      return user;
    });
    startSession(c, db, user.id);
    return c.json({ user });
  });

  api.post("/auth/login", async (c) => {
    const { username, password } = await body(c, loginSchema);
    const ip = clientIp(c, config.trustProxy);
    if (userLimiter.blocked(username) || ipLimiter.blocked(ip)) {
      throw new HTTPException(429, { message: "Too many attempts. Try again in a few minutes." });
    }
    const row = findUserByUsername(db, username);
    const ok = row ? await verifyPassword(password, row.password_hash) : (await verifyPassword(password, await getDummyHash()), false);
    if (!row || !ok) {
      userLimiter.fail(username);
      ipLimiter.fail(ip);
      throw new HTTPException(401, { message: "Wrong username or password" });
    }
    userLimiter.reset(username);
    startSession(c, db, row.id);
    return c.json({ user: toPublic(row) });
  });

  api.post("/auth/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deleteSession(db, token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  api.post("/auth/password", auth, async (c) => {
    const { current, next } = await body(c, changePasswordSchema);
    const me = c.get("user");
    const row = findUser(db, me.id)!;
    if (!(await verifyPassword(current, row.password_hash))) throw new HTTPException(400, { message: "Current password is wrong" });
    const hash = await hashPassword(next);
    const token = getCookie(c, SESSION_COOKIE)!;
    tx(db, () => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, me.id);
      // Sign out every other device.
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(me.id);
    });
    deleteSession(db, token);
    startSession(c, db, me.id);
    return c.json({ ok: true });
  });

  api.get("/users", auth, (c) => c.json({ users: listUsers(db) }));

  api.post("/users", auth, ownerOnly, async (c) => {
    const input = await body(c, createUserSchema);
    if (findUserByUsername(db, input.username)) throw new HTTPException(409, { message: "That username is taken" });
    const user = await insertUser(db, { ...input, role: "member" });
    return c.json({ user }, 201);
  });

  api.delete("/users/:id", auth, ownerOnly, (c) => {
    const id = c.req.param("id");
    if (id === c.get("user").id) throw new HTTPException(400, { message: "You can't remove yourself" });
    const res = db.prepare("DELETE FROM users WHERE id = ? AND role = 'member'").run(id);
    if (res.changes === 0) throw new HTTPException(404, { message: "No such member" });
    return c.json({ ok: true });
  });

  api.post("/sync", auth, async (c) => {
    const req = await body(c, syncRequestSchema);
    const { changed, ...res } = sync(db, c.get("user").id, req);
    if (changed) bus.emit({ seq: res.cursor, clientId: req.clientId });
    return c.json(res);
  });

  api.get("/events", auth, (c) => {
    const clientId = c.req.query("clientId") ?? "";
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let pending = false;
      const off = bus.on((e) => {
        if (e.clientId === clientId || pending) return;
        pending = true;
        queueMicrotask(() => {
          pending = false;
          stream.writeSSE({ event: "changed", data: String(e.seq) }).catch(() => {});
        });
      });
      stream.onAbort(off);
      try {
        await stream.writeSSE({ event: "hello", data: String(currentSeq(db)), retry: 5000 });
        while (!stream.aborted) {
          await stream.sleep(25_000);
          if (!stream.aborted) await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        off();
      }
    });
  });

  api.get("/lookup/:barcode", auth, async (c) => {
    const barcode = c.req.param("barcode");
    if (!/^\d{6,14}$/.test(barcode)) throw new HTTPException(400, { message: "Not a product barcode" });
    if (!config.barcodeLookup) return c.json({ barcode, found: false, disabled: true });
    const result = await lookupBarcode(db, barcode, fetchImpl);
    if (!result) throw new HTTPException(502, { message: "Barcode lookup is unavailable right now" });
    return c.json(result);
  });

  api.get("/export", auth, (c) => {
    c.header("Content-Disposition", `attachment; filename="larder-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ exportedAt: new Date().toISOString(), version: VERSION, data: exportAll(db) });
  });

  api.get("/backup", auth, ownerOnly, (c) => {
    const file = join(tmpdir(), `larder-dl-${randomUUID()}.db`);
    try {
      db.prepare("VACUUM INTO ?").run(file);
      const bytes = readFileSync(file);
      return c.body(bytes, 200, {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="larder-${new Date().toISOString().slice(0, 10)}.db"`,
      });
    } finally {
      rmSync(file, { force: true });
    }
  });

  api.all("*", (c) => c.json({ error: "Not found" }, 404));
  app.route("/api", api);

  // The built web client. Hashed assets are immutable; everything else must
  // revalidate so a new deploy (and its service worker) is picked up.
  if (existsSync(config.webDir)) {
    app.use(
      "*",
      serveStatic({
        root: config.webDir,
        onFound: (path, c) => {
          c.header(
            "Cache-Control",
            path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
          );
        },
      }),
    );
    app.get(
      "*",
      serveStatic({ root: config.webDir, path: "index.html", onFound: (_p, c) => c.header("Cache-Control", "no-cache") }),
    );
  }

  return app;
}

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PublicUser } from "../shared/schema.ts";
import type { DB } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const SESSION_TTL_MS = 180 * 86_400_000;
export const SESSION_COOKIE = "larder_session";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(expected, actual);
}

// A real hash to compare against when the username does not exist, so a
// failed login takes the same time either way.
let dummyHash: Promise<string> | undefined;
export function getDummyHash() {
  return (dummyHash ??= hashPassword(randomUUID()));
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createSession(db: DB, userId: string, userAgent: string | undefined): string {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    sha256(token), userId, now, now + SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null,
  );
  return token;
}

export function deleteSession(db: DB, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "owner" | "member";
  password_hash: string;
}

export function toPublic(u: UserRow): PublicUser {
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}

/** Resolve a session token to its user, sliding the expiry forward. */
export function sessionUser(db: DB, token: string): PublicUser | null {
  const hash = sha256(token);
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.name, u.role, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hash) as (UserRow & { expires_at: number }) | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    return null;
  }
  // Refresh at most once a day to avoid a write on every request.
  if (row.expires_at - now < SESSION_TTL_MS - 86_400_000) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(now + SESSION_TTL_MS, hash);
  }
  return toPublic(row);
}

export function findUserByUsername(db: DB, username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function findUser(db: DB, id: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function userCount(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
}

export function listUsers(db: DB): PublicUser[] {
  return (db.prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[]).map(toPublic);
}

export async function insertUser(db: DB, u: { username: string; name: string; password: string; role: "owner" | "member" }): Promise<PublicUser> {
  return insertUserHashed(db, { ...u, hash: await hashPassword(u.password) });
}

/** Synchronous insert with a pre-computed hash, so it can run inside a transaction. */
export function insertUserHashed(db: DB, u: { username: string; name: string; hash: string; role: "owner" | "member" }): PublicUser {
  const id = randomUUID();
  const hash = u.hash;
  db.prepare("INSERT INTO users (id, username, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, u.username, u.name, hash, u.role, Date.now(),
  );
  return { id, username: u.username, name: u.name, role: u.role };
}

/** Fixed-window limiter for failed logins, keyed by username and by client address. */
export class LoginLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private max: number;
  private windowMs: number;
  constructor(max = 10, windowMs = 15 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(key: string): boolean {
    const h = this.hits.get(key);
    if (!h) return false;
    if (h.resetAt < Date.now()) {
      this.hits.delete(key);
      return false;
    }
    return h.count >= this.max;
  }

  fail(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt < now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else h.count++;
    if (this.hits.size > 10_000) this.hits.clear();
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}

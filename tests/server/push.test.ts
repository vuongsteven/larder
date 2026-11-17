import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PushPayload } from "../../shared/schema.ts";
import { buildDigest, runDailyReminders, type PushSender, type PushTarget, type SendResult } from "../../server/push.ts";
import { serverWrite } from "../../server/sync.ts";
import { client, makeServer } from "./helpers.ts";

const TODAY = "2026-11-16"; // a Monday
const item = (name: string, expiresOn: string | null) => ({ name, expiresOn });

describe("buildDigest", () => {
  it("lists what expires from today to two days out, soonest first", () => {
    const digest = buildDigest(
      [
        item("Eggs", "2026-11-18"),
        item("Yesterday's soup", "2026-11-15"),
        item("Rice", null),
        item("Milk", "2026-11-16"),
        item("Butter", "2026-11-19"),
        item("Chicken thighs", "2026-11-17"),
        item("Apples", "2026-11-17"),
      ],
      TODAY,
    );
    expect(digest).toEqual({
      title: "4 things to use soon",
      body: "Milk (today), Apples (tomorrow), Chicken thighs (tomorrow), Eggs (Wed)",
      url: "/stock?filter=expiring",
      tag: "larder-expiry",
    });
  });

  it("names four things and counts the rest", () => {
    const names = ["A", "B", "C", "D", "E", "F"];
    const digest = buildDigest(names.map((n) => item(n, TODAY)), TODAY);
    expect(digest?.title).toBe("6 things to use soon");
    expect(digest?.body).toBe("A (today), B (today), C (today), D (today) and 2 more");
  });

  it("uses the singular for one thing and works across a month end", () => {
    expect(buildDigest([item("Yoghurt", "2026-12-01")], "2026-11-30")).toMatchObject({ title: "1 thing to use soon", body: "Yoghurt (tomorrow)" });
    expect(buildDigest([item("Yoghurt", "2026-12-02")], "2026-11-30")?.body).toBe("Yoghurt (Wed)");
  });

  it("is null when nothing qualifies", () => {
    expect(buildDigest([], TODAY)).toBeNull();
    expect(buildDigest([item("Rice", null), item("Old", "2026-11-01"), item("Later", "2026-11-19")], TODAY)).toBeNull();
  });
});

const key = (bytes: number) => randomBytes(bytes).toString("base64url");
const subscription = (endpoint: string) => ({ endpoint, keys: { p256dh: key(65), auth: key(16) } });

/** A push service stand-in: records every send and answers per endpoint. */
function fakeSender() {
  const calls: { endpoint: string; payload: PushPayload }[] = [];
  const answers = new Map<string, SendResult>();
  const send: PushSender = async (sub: PushTarget, payload) => {
    calls.push({ endpoint: sub.endpoint, payload });
    return answers.get(sub.endpoint) ?? "ok";
  };
  return { send, calls, answers, endpoints: () => calls.map((c) => c.endpoint).sort() };
}

let push: ReturnType<typeof fakeSender>;
let srv: ReturnType<typeof makeServer>;
let owner: ReturnType<typeof client>;
let member: ReturnType<typeof client>;

const PHONE = "https://push.example.com/send/phone";
const TABLET = "https://push.example.com/send/tablet";
const at = (day: number, time: string) => {
  const [h, m] = time.split(":").map(Number);
  return new Date(2026, 10, day, h, m);
};
const addItem = (name: string, expiresOn: string | null) =>
  serverWrite(srv.db, "items", { name, locationId: "loc-1", addedOn: "2026-11-01", expiresOn }, null);
const rows = () => srv.db.prepare("SELECT endpoint, user_id, last_sent_day FROM push_subscriptions ORDER BY endpoint").all();

beforeEach(async () => {
  push = fakeSender();
  srv = makeServer({ pushSender: push.send });
  owner = client(srv.app);
  await owner.post("/api/auth/setup", { username: "alex", name: "Alex", password: "password123" });
  await owner.post("/api/users", { username: "sam", name: "Sam", password: "password123" });
  member = client(srv.app);
  await member.post("/api/auth/login", { username: "sam", password: "password123" });
});
afterEach(() => srv.close());

describe("runDailyReminders", () => {
  beforeEach(async () => {
    expect((await owner.post("/api/push/subscriptions", subscription(PHONE))).status).toBe(201);
    expect((await member.post("/api/push/subscriptions", subscription(TABLET))).status).toBe(201);
    addItem("Milk", "2026-11-17");
  });

  it("waits for the reminder time, then sends each device the digest once a day", async () => {
    await runDailyReminders(srv.db, push.send, at(16, "07:59"), "08:00");
    expect(push.calls).toEqual([]);

    expect(await runDailyReminders(srv.db, push.send, at(16, "08:00"), "08:00")).toEqual({ sent: 2, failed: 0 });
    expect(push.endpoints()).toEqual([PHONE, TABLET]);
    expect(push.calls[0].payload).toMatchObject({ title: "1 thing to use soon", body: "Milk (tomorrow)" });

    await runDailyReminders(srv.db, push.send, at(16, "08:05"), "08:00");
    await runDailyReminders(srv.db, push.send, at(16, "23:59"), "08:00");
    expect(push.calls).toHaveLength(2);

    await runDailyReminders(srv.db, push.send, at(17, "07:00"), "08:00");
    expect(push.calls).toHaveLength(2);
    await runDailyReminders(srv.db, push.send, at(17, "08:00"), "08:00");
    expect(push.calls).toHaveLength(4);
    expect(push.calls[3].payload.body).toBe("Milk (today)");
  });

  it("retries only the device whose send failed", async () => {
    push.answers.set(TABLET, "error");
    expect(await runDailyReminders(srv.db, push.send, at(16, "09:00"), "08:00")).toEqual({ sent: 1, failed: 1 });
    push.answers.clear();
    push.calls.length = 0;
    await runDailyReminders(srv.db, push.send, at(16, "09:05"), "08:00");
    expect(push.endpoints()).toEqual([TABLET]);
    expect(rows()).toEqual([
      expect.objectContaining({ endpoint: PHONE, last_sent_day: "2026-11-16" }),
      expect.objectContaining({ endpoint: TABLET, last_sent_day: "2026-11-16" }),
    ]);
  });

  it("forgets a device the push service says is gone", async () => {
    push.answers.set(PHONE, "gone");
    await runDailyReminders(srv.db, push.send, at(16, "09:00"), "08:00");
    expect(rows()).toEqual([expect.objectContaining({ endpoint: TABLET })]);
  });

  it("sends nothing on a day when nothing expires, and still marks the day done", async () => {
    await runDailyReminders(srv.db, push.send, at(20, "09:00"), "08:00");
    expect(push.calls).toEqual([]);
    expect(rows().map((r) => r.last_sent_day)).toEqual(["2026-11-20", "2026-11-20"]);
    // Something added later that day waits for tomorrow's reminder.
    addItem("Cream", "2026-11-21");
    await runDailyReminders(srv.db, push.send, at(20, "10:00"), "08:00");
    expect(push.calls).toEqual([]);
  });

  it("ignores deleted items", async () => {
    srv.db.prepare("UPDATE records SET deleted = 1 WHERE tbl = 'items'").run();
    await runDailyReminders(srv.db, push.send, at(16, "09:00"), "08:00");
    expect(push.calls).toEqual([]);
  });
});

describe("push API", () => {
  it("gives every signed-in user the server's public key, the same each time", async () => {
    const a = await owner.get("/api/push/key");
    expect(a.status).toBe(200);
    expect(a.json.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(a.json.reminderTime).toBe("08:00");
    expect((await member.get("/api/push/key")).json.publicKey).toBe(a.json.publicKey);
  });

  it("accepts only https push endpoints and well-formed keys", async () => {
    expect((await owner.post("/api/push/subscriptions", subscription("http://push.example.com/x"))).status).toBe(400);
    expect((await owner.post("/api/push/subscriptions", subscription("javascript:alert(1)"))).status).toBe(400);
    expect((await owner.post("/api/push/subscriptions", { endpoint: PHONE, keys: { p256dh: "short", auth: key(16) } })).status).toBe(400);
    expect((await owner.post("/api/push/subscriptions", { endpoint: PHONE, keys: { p256dh: key(65), auth: "not base64!!!!!!!!!" } })).status).toBe(400);
    expect(rows()).toEqual([]);
  });

  it("upserts by endpoint: the last user to subscribe a device owns it", async () => {
    await owner.post("/api/push/subscriptions", subscription(PHONE));
    await owner.post("/api/push/subscriptions", subscription(PHONE));
    const ownerId = (rows()[0] as { user_id: string }).user_id;
    expect(rows()).toHaveLength(1);
    await member.post("/api/push/subscriptions", subscription(PHONE));
    expect(rows()).toHaveLength(1);
    expect((rows()[0] as { user_id: string }).user_id).not.toBe(ownerId);
  });

  it("only deletes the caller's own subscription", async () => {
    await owner.post("/api/push/subscriptions", subscription(PHONE));
    expect((await member.del("/api/push/subscriptions", { endpoint: PHONE })).status).toBe(200);
    expect(rows()).toHaveLength(1);
    expect((await owner.del("/api/push/subscriptions", { endpoint: PHONE })).status).toBe(200);
    expect(rows()).toEqual([]);
  });

  it("sends a test reminder to the caller's devices only, without using up the day", async () => {
    await owner.post("/api/push/subscriptions", subscription(PHONE));
    await member.post("/api/push/subscriptions", subscription(TABLET));
    const res = await owner.post("/api/push/test");
    expect(res.json).toEqual({ sent: 1, failed: 0 });
    expect(push.endpoints()).toEqual([PHONE]);
    // Nothing expires, so the test still shows something.
    expect(push.calls[0].payload.title).toBe("Expiry reminders are on");
    expect(rows().every((r) => r.last_sent_day === null)).toBe(true);

    push.answers.set(PHONE, "gone");
    expect((await owner.post("/api/push/test")).json).toEqual({ sent: 0, failed: 1 });
    expect(rows()).toEqual([expect.objectContaining({ endpoint: TABLET })]);
  });

  it("requires a session, and the X-Larder header for writes", async () => {
    const anon = client(srv.app);
    expect((await anon.get("/api/push/key")).status).toBe(401);
    expect((await anon.post("/api/push/subscriptions", subscription(PHONE))).status).toBe(401);
    expect((await anon.post("/api/push/test")).status).toBe(401);
    const res = await srv.app.request("/api/push/subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: owner.cookie },
      body: JSON.stringify(subscription(PHONE)),
    });
    expect(res.status).toBe(403);
    expect(rows()).toEqual([]);
  });
});

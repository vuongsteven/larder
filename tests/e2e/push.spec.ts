import { expect, test, type Page } from "@playwright/test";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import ece from "http_ece";
import { addItem, tag, waitSynced } from "./helpers.ts";

/** Stands in for Apple's, Google's or Mozilla's push service: records each delivery. */
async function fakePushService() {
  const certDir = process.env.LARDER_E2E_CERT_DIR!;
  const received: { headers: IncomingHttpHeaders; body: Buffer }[] = [];
  const server = createServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

/** Delete items by name through the sync API, as another device would. */
async function removeItemsNamed(page: Page, name: string) {
  const headers = { "x-larder": "1" };
  const res = await page.request.post("/api/sync", { headers, data: { clientId: "e2e-cleanup", cursor: 0, ops: [] } });
  const { changes } = (await res.json()) as { changes: { table: string; row: { id: string; name?: string } }[] };
  const ops = changes
    .filter((c) => c.table === "items" && c.row.name === name)
    .map((c) => ({ opId: `cleanup-${c.row.id}`, table: "items", id: c.row.id, delete: true }));
  if (ops.length) await page.request.post("/api/sync", { headers, data: { clientId: "e2e-cleanup", cursor: 0, ops } });
}

test.skip(({ browserName }) => browserName !== "chromium", "Playwright's WebKit doesn't run service workers or web push");
// The default headless shell refuses notifications outright; full Chromium shows them.
test.use({ channel: "chromium" });

test("turns on expiry reminders and receives one", async ({ page, context, baseURL }) => {
  const service = await fakePushService();
  const endpoint = `${service.origin}/send/${tag()}`;
  const name = `Chicken thighs ${tag()}`;
  try {
    // The browser's half of the encryption: the keys a real PushSubscription would carry.
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const authSecret = randomBytes(16);
    // Playwright's Chromium has no push service to subscribe with, so hand the app a
    // subscription that points at the fake one.
    await page.addInitScript(
      ({ endpoint, p256dh, auth }) => {
        let current: unknown = null;
        PushManager.prototype.subscribe = async function () {
          current = {
            endpoint,
            toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh, auth } }),
            unsubscribe: async () => ((current = null), true),
          };
          return current as PushSubscription;
        };
        PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
      },
      { endpoint, p256dh: ecdh.getPublicKey("base64url"), auth: authSecret.toString("base64url") },
    );
    await context.grantPermissions(["notifications"]);

    // Let the service worker take control first, so the push can be delivered into it.
    await page.goto("/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();

    // Due today, so it sorts ahead of anything other runs left in the shared household.
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    await addItem(page, name, { place: "Fridge", expiresOn: today });
    await waitSynced(page);

    await page.getByRole("link", { name: "More" }).click();
    const toggle = page.getByRole("switch", { name: "Expiry reminders" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Send a test reminder" }).click();
    await expect(page.getByText(/Test reminder sent/)).toBeVisible();

    await expect.poll(() => service.received.length).toBe(1);
    const { headers, body } = service.received[0];
    // VAPID: a JWT signed by the server, addressed to this push service.
    expect(headers.authorization).toMatch(/^vapid t=/);
    const jwt = headers.authorization!.match(/t=([^,\s]+)/)![1];
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(claims.aud).toBe(service.origin);
    expect(headers["content-encoding"]).toBe("aes128gcm");

    // Only the browser's private key can read the payload.
    const plaintext = ece.decrypt(body, { version: "aes128gcm", privateKey: ecdh, authSecret }).toString();
    const payload = JSON.parse(plaintext);
    expect(payload).toMatchObject({ title: expect.stringMatching(/to use soon$/), url: "/stock?filter=expiring", tag: "larder-expiry" });
    expect(payload.body).toContain(`${name} (today)`);

    // Hand the push to the service worker as the push service would, and check it shows.
    const cdp = await context.newCDPSession(page);
    const registration = new Promise<string>((resolve) =>
      cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
        const reg = e.registrations.find((r) => !r.isDeleted);
        if (reg) resolve(reg.registrationId);
      }),
    );
    await cdp.send("ServiceWorker.enable");
    const registrationId = await registration;
    // Chromium's DevTools push delivery sometimes drops the first push after the
    // ServiceWorker domain is enabled (5 of 20 fresh contexts with a bare service
    // worker; a second delivery always arrived). Real pushes come from the push
    // service, not DevTools, so redeliver: the shared tag replaces, never stacks.
    await expect(async () => {
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(baseURL!).origin, registrationId, data: plaintext });
      await expect
        .poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}: ${n.body}`)), { timeout: 2_000 })
        .toContainEqual(expect.stringContaining(name));
    }).toPass({ timeout: 10_000 });

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: "Send a test reminder" })).toHaveCount(0);
  } finally {
    // A failed run must not leave a subscription that later runs try to reach.
    await page.request
      .delete("/api/push/subscriptions", { headers: { "x-larder": "1" }, data: { endpoint } })
      .catch(() => {});
    // ...nor an expiring item that crowds later runs' digests.
    await removeItemsNamed(page, name).catch(() => {});
    await service.close();
  }
});

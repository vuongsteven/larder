import { expect, test } from "@playwright/test";
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

test.skip(({ browserName }) => browserName !== "chromium", "Playwright's WebKit doesn't run service workers or web push");
// The default headless shell refuses notifications outright; full Chromium shows them.
test.use({ channel: "chromium" });

test("turns on expiry reminders and receives one", async ({ page, context, baseURL }) => {
  const service = await fakePushService();
  try {
    // The browser's half of the encryption: the keys a real PushSubscription would carry.
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const authSecret = randomBytes(16);
    const endpoint = `${service.origin}/send/${tag()}`;
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

    const tomorrow = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
    const name = `Chicken thighs ${tag()}`;
    await addItem(page, name, { place: "Fridge", expiresOn: tomorrow });
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
    expect(payload.body).toContain(`${name} (tomorrow)`);

    // Hand the push to the service worker as the push service would, and check it shows.
    const cdp = await context.newCDPSession(page);
    const registration = new Promise<string>((resolve) =>
      cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
        const reg = e.registrations.find((r) => !r.isDeleted);
        if (reg) resolve(reg.registrationId);
      }),
    );
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(baseURL!).origin, registrationId: await registration, data: plaintext });
    await expect
      .poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}: ${n.body}`)))
      .toContainEqual(expect.stringContaining(name));

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: "Send a test reminder" })).toHaveCount(0);
  } finally {
    await service.close();
  }
});

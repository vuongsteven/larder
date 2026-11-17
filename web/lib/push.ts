// Expiry reminders: this device's Web Push subscription, as a small state machine.
import { api } from "./api.ts";
import { isIOS, isStandalone } from "./util.ts";

export type PushState =
  | { kind: "unsupported"; reason: string }
  | { kind: "needs-install" } // iPhone and iPad only allow push for Home Screen apps
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on" };

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (!window.isSecureContext) return { kind: "unsupported", reason: "Reminders only work on Larder's https:// address." };
  if (isIOS() && !isStandalone()) return { kind: "needs-install" };
  if (!supported()) return { kind: "unsupported", reason: "This browser can't show notifications from Larder." };
  if (Notification.permission === "denied") return { kind: "denied" };
  return Notification.permission === "granted" && (await currentSubscription()) ? { kind: "on" } : { kind: "off" };
}

function base64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Larder is still setting up on this device. Try again in a moment.")), 10_000),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/** Call straight from a tap: browsers only show the permission prompt for a user gesture. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return { kind: "denied" };
  if (permission !== "granted") return { kind: "off" };
  const [{ publicKey }, reg] = await Promise.all([api<{ publicKey: string }>("/api/push/key"), activeRegistration()]);
  // A subscription made for an older server key can't be reused, so always start fresh.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(publicKey) });
  try {
    await api("/api/push/subscriptions", { body: sub.toJSON() });
  } catch (err) {
    await sub.unsubscribe().catch(() => {});
    throw err;
  }
  return { kind: "on" };
}

/**
 * Stop reminders on this device. Unsubscribing locally is what matters: if the
 * server can't be told now, its next send fails as gone and it forgets the device.
 */
export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await sub.unsubscribe().catch(() => {});
    await api("/api/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  }
  return { kind: "off" };
}

export function sendTestReminder() {
  return api<{ sent: number; failed: number }>("/api/push/test", { body: {} });
}

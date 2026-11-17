import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../server/app.ts";
import { loadConfig } from "../../server/config.ts";
import { openDb } from "../../server/db.ts";
import { ChangeBus } from "../../server/events.ts";

export function makeServer(opts: { fetchImpl?: typeof fetch; barcodeLookup?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "larder-test-"));
  const db = openDb(join(dir, "larder.db"));
  const bus = new ChangeBus();
  const config = {
    ...loadConfig({}),
    dataDir: dir,
    webDir: join(dir, "no-web"),
    barcodeLookup: opts.barcodeLookup ?? true,
    logRequests: false,
  };
  const app = createApp({ db, config, bus, fetchImpl: opts.fetchImpl });
  return {
    app,
    db,
    bus,
    dir,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A cookie-keeping client for the Hono app, like one browser. */
export function client(app: ReturnType<typeof makeServer>["app"]) {
  let cookie = "";
  async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-larder": "1",
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  return {
    get: (p: string) => req("GET", p),
    post: (p: string, b: unknown = {}, h?: Record<string, string>) => req("POST", p, b, h),
    del: (p: string) => req("DELETE", p),
    get cookie() {
      return cookie;
    },
  };
}

let opSeq = 0;
export const opId = () => `op-${Date.now()}-${++opSeq}`;

export const ITEM = { name: "Milk", locationId: "loc-1", addedOn: "2026-01-01" };

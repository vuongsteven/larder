import { writeFileSync } from "node:fs";
import type { FullConfig } from "@playwright/test";

/** Create the household owner once and save the session for every test. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const res = await fetch(`${baseURL}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-larder": "1" },
    body: JSON.stringify({ username: "tester", name: "Tess Tester", password: "password123" }),
  });
  if (!res.ok) throw new Error(`setup failed: ${res.status} ${await res.text()}`);
  const token = res.headers.get("set-cookie")!.split(";")[0].split("=")[1];
  writeFileSync(
    "tests/e2e/.auth.json",
    JSON.stringify({
      cookies: [{ name: "larder_session", value: token, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }],
      origins: [],
    }),
  );
}

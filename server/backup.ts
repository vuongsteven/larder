import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.ts";

/** Write a consistent snapshot of the database and keep the newest `keep` snapshots. */
export function backup(db: DB, dir: string, keep: number): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const file = join(dir, `larder-${stamp}.db`);
  rmSync(file, { force: true });
  db.prepare("VACUUM INTO ?").run(file);
  const old = readdirSync(dir)
    .filter((f) => /^larder-\d{8}-\d{6}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) rmSync(join(dir, f), { force: true });
  return file;
}

/** Age in ms of the newest snapshot, or Infinity if there is none. */
export function newestBackupAge(dir: string): number {
  try {
    const times = readdirSync(dir)
      .filter((f) => /^larder-\d{8}-\d{6}\.db$/.test(f))
      .map((f) => statSync(join(dir, f)).mtimeMs);
    return times.length ? Date.now() - Math.max(...times) : Infinity;
  } catch {
    return Infinity;
  }
}

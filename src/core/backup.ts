import type { TrackerSettings } from "./types";
import type { EventStore, StorageIO } from "./store";
import { buildBundle } from "./importExport";

const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (d: Date): string => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export async function createBackup(io: StorageIO, dir: string, store: EventStore, settings: TrackerSettings | undefined, now: Date): Promise<string> {
  if (!(await io.exists(dir))) await io.mkdir(dir);
  let path = `${dir}/backup-${stamp(now)}.json`;
  for (let i = 1; await io.exists(path); i++) path = `${dir}/backup-${stamp(now)}-${i}.json`;
  await io.write(path, JSON.stringify(buildBundle(store.list(), settings, now), null, 1));
  return path;
}

/** Deletes the oldest automatic backups beyond `keep`. Only touches files named backup-*.json. */
export async function pruneBackups(io: StorageIO, dir: string, keep: number): Promise<string[]> {
  if (keep < 1 || !(await io.exists(dir))) return [];
  const files = (await io.list(dir)).filter((f) => /\/backup-[\d-]+\.json$/.test(f) || /^backup-[\d-]+\.json$/.test(f)).sort();
  const doomed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of doomed) await io.remove(f);
  return doomed;
}

export function backupDue(lastBackupAt: string | null, intervalDays: number, now: Date): boolean {
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  return Number.isNaN(last) || now.getTime() - last >= intervalDays * 86400000;
}

/**
 * Schema versioning. Every stored record carries `v`. To change the schema: bump the constant in types.ts and
 * append a Migration { from: N, migrate } that returns the record in shape N+1. Records are migrated on read and
 * are never rewritten in place; records newer than this plugin understands are quarantined, never dropped.
 */
export interface Migration { from: number; migrate: (record: Record<string, unknown>) => Record<string, unknown> }
export const MIGRATIONS: Migration[] = [];

export type MigrationResult = { ok: true; record: Record<string, unknown>; migrated: boolean } | { ok: false; reason: string };

export function migrateRecord(rec: Record<string, unknown>, target: number, migrations: Migration[] = MIGRATIONS): MigrationResult {
  let v = typeof rec.v === "number" && Number.isInteger(rec.v) ? rec.v : 1;
  if (v > target) return { ok: false, reason: `record schema v${v} is newer than supported v${target}` };
  let cur = rec;
  let migrated = false;
  while (v < target) {
    const m = migrations.find((x) => x.from === v);
    if (!m) return { ok: false, reason: `no migration from v${v}` };
    cur = { ...m.migrate({ ...cur }), v: v + 1 };
    v++;
    migrated = true;
  }
  return { ok: true, record: cur, migrated };
}

import type { StorageIO } from "../src/core/store";
import type { TrackerEvent, SubjectNode } from "../src/core/types";
import { starterTree } from "../src/core/defaults";
import { parseEntry, type ParseContext } from "../src/core/parser";
import { createDefaultSettings } from "../src/core/defaults";

export class MemIO implements StorageIO {
  files = new Map<string, string>();
  async exists(p: string) { return this.files.has(p) || [...this.files.keys()].some((k) => k.startsWith(p + "/")); }
  async read(p: string) { const v = this.files.get(p); if (v === undefined) throw new Error("ENOENT " + p); return v; }
  async write(p: string, d: string) { this.files.set(p, d); }
  async append(p: string, d: string) { this.files.set(p, (this.files.get(p) ?? "") + d); }
  async list(dir: string) { return [...this.files.keys()].filter((k) => k.startsWith(dir + "/") && !k.slice(dir.length + 1).includes("/")); }
  async mkdir() { /* implicit */ }
  async remove(p: string) { this.files.delete(p); }
}

let n = 0;
export function ev(date: string, minutes: number, path: string[] = ["Academic", "Mathematics"], extra: Partial<TrackerEvent> = {}): TrackerEvent {
  const timestamp = extra.timestamp ?? `${date}T10:00:00+00:00`;
  return { id: `e${++n}`, timestamp, date, path, durationMinutes: minutes, tags: [], notes: "", source: "manual", createdAt: timestamp, updatedAt: timestamp, ...extra };
}

export function ctx(now = new Date(2026, 8, 29, 10, 0), tree: SubjectNode[] = starterTree()): ParseContext {
  const s = createDefaultSettings("2026-09-01");
  return { tree, resultScale: s.resultScale, kinds: s.kinds, measurements: s.measurements, now, defaultCategory: "Academic", defaultDurationUnit: "minutes" };
}
export const parse = (input: string, now?: Date, tree?: SubjectNode[]) => parseEntry(input, ctx(now, tree));

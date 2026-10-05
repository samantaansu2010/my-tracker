/**
 * Append-only event log. Each mutation is one JSON line (put / delete / rename) in Database/events-YYYY.jsonl.
 * State = replay of all lines in file/line order. Files are never rewritten, so a crash can at worst leave one
 * truncated last line, which is quarantined (not deleted) on the next load.
 */
import type { TrackerEvent } from "./types";
import { EVENT_SCHEMA_VERSION } from "./types";
import { formatLocalIso } from "./dates";
import { newId } from "./ids";
import { eventFingerprint, normalizeRaw, validateEvent } from "./integrity";
import { MIGRATIONS, migrateRecord, type Migration } from "./migrate";
import { isPrefixPath } from "./hierarchy";

export interface StorageIO {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  mkdir(dir: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export type LogOp =
  | { v: number; op: "put"; at: string; event: TrackerEvent }
  | { v: number; op: "delete"; at: string; id: string }
  | { v: number; op: "rename"; at: string; from: string[]; to: string[] };

export interface QuarantineEntry { file: string; line: number; reason: string; raw: string }
export interface LoadReport { files: number; ops: number; events: number; quarantined: QuarantineEntry[]; newlyQuarantined: number }
export type Result<T> = { ok: true; value: T } | { ok: false; reason: "invalid" | "duplicate" | "not-found" | "io"; errors: string[]; existingId?: string };
export interface ImportReport { added: number; duplicates: number; conflicts: number; invalid: { index: number; errors: string[]; raw: unknown }[] }
export type NewEvent = Omit<TrackerEvent, "id" | "date" | "createdAt" | "updatedAt"> & { id?: string; date?: string };

const FILE_RE = /events-(\d{4})\.jsonl$/;

export class EventStore {
  private byId = new Map<string, TrackerEvent>();
  private fingerprints = new Map<string, Set<string>>();
  private externals = new Map<string, string>();
  private undoStack: { ops: LogOp[]; label: string }[] = [];
  private needsNewline = new Set<string>();
  private knownFiles = new Set<string>();
  private cache: TrackerEvent[] | null = null;
  private listeners = new Set<() => void>();
  revision = 0;
  lastWriteAt = 0;
  report: LoadReport = { files: 0, ops: 0, events: 0, quarantined: [], newlyQuarantined: 0 };

  constructor(
    private io: StorageIO,
    readonly dir: string,
    private opts: { clock?: () => Date; migrations?: Migration[]; schemaVersion?: number } = {},
  ) {}

  private now(): Date { return this.opts.clock ? this.opts.clock() : new Date(); }
  private target(): number { return this.opts.schemaVersion ?? EVENT_SCHEMA_VERSION; }
  onChange(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private notify(): void { this.cache = null; this.revision++; this.listeners.forEach((f) => f()); }

  // ---------- reading ----------
  async load(): Promise<LoadReport> {
    this.byId.clear(); this.fingerprints.clear(); this.externals.clear(); this.needsNewline.clear(); this.knownFiles.clear();
    const report: LoadReport = { files: 0, ops: 0, events: 0, quarantined: [], newlyQuarantined: 0 };
    const files = (await this.io.list(this.dir)).filter((f) => FILE_RE.test(f)).sort((a, b) => FILE_RE.exec(a)![1].localeCompare(FILE_RE.exec(b)![1]));
    for (const file of files) {
      const text = await this.io.read(file);
      report.files++;
      this.knownFiles.add(file);
      if (text.length && !text.endsWith("\n")) this.needsNewline.add(file);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;
        const problem = this.applyLine(line);
        if (problem) report.quarantined.push({ file, line: i + 1, reason: problem, raw: line });
        else report.ops++;
      }
    }
    report.events = this.byId.size;
    report.newlyQuarantined = await this.quarantine(report.quarantined);
    this.report = report;
    this.notify();
    return report;
  }

  private applyLine(line: string): string | null {
    let obj: unknown;
    try { obj = JSON.parse(line); } catch { return "not valid JSON (possibly a truncated write)"; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "not a JSON object";
    const mig = migrateRecord(obj as Record<string, unknown>, this.target(), this.opts.migrations ?? MIGRATIONS);
    if (!mig.ok) return mig.reason;
    return this.apply(mig.record as unknown as LogOp);
  }

  /** Applies one op to memory. Returns an error string for unusable ops (which are then quarantined). */
  private apply(op: LogOp): string | null {
    switch (op.op) {
      case "put": {
        const v = validateEvent(op.event);
        if (!v.ok) return `invalid event: ${v.errors.join("; ")}`;
        this.setEvent(v.event);
        return null;
      }
      case "delete": {
        const old = typeof op.id === "string" ? this.byId.get(op.id) : undefined;
        if (old) this.removeEvent(old);
        return typeof op.id === "string" ? null : "delete op without id";
      }
      case "rename": {
        if (!Array.isArray(op.from) || !Array.isArray(op.to) || !op.from.length || !op.to.length) return "malformed rename op";
        for (const e of [...this.byId.values()]) {
          if (isPrefixPath(op.from, e.path)) this.setEvent({ ...e, path: [...op.to, ...e.path.slice(op.from.length)] });
        }
        return null;
      }
      default: return `unknown op "${String((op as { op?: unknown }).op)}"`;
    }
  }

  private setEvent(e: TrackerEvent): void {
    const old = this.byId.get(e.id);
    if (old) this.unindex(old);
    this.byId.set(e.id, e);
    const fp = eventFingerprint(e);
    (this.fingerprints.get(fp) ?? this.fingerprints.set(fp, new Set()).get(fp)!).add(e.id);
    if (e.externalId) this.externals.set(e.externalId, e.id);
  }
  private unindex(e: TrackerEvent): void {
    const fp = eventFingerprint(e);
    const set = this.fingerprints.get(fp);
    set?.delete(e.id);
    if (set && !set.size) this.fingerprints.delete(fp);
    if (e.externalId && this.externals.get(e.externalId) === e.id) this.externals.delete(e.externalId);
  }
  private removeEvent(e: TrackerEvent): void { this.unindex(e); this.byId.delete(e.id); }

  private async quarantine(entries: QuarantineEntry[]): Promise<number> {
    if (!entries.length) return 0;
    const file = `${this.dir}/quarantine.jsonl`;
    const seen = new Set<string>();
    if (await this.io.exists(file)) {
      for (const l of (await this.io.read(file)).split("\n")) {
        try { const o = JSON.parse(l) as QuarantineEntry; seen.add(`${o.file}\u0000${o.raw}`); } catch { /* ignore */ }
      }
    }
    const fresh = entries.filter((e) => !seen.has(`${e.file}\u0000${e.raw}`));
    if (!fresh.length) return 0;
    const text = fresh.map((e) => JSON.stringify({ ...e, at: formatLocalIso(this.now()) })).join("\n") + "\n";
    if (await this.io.exists(file)) {
      const existing = await this.io.read(file);
      await this.io.append(file, (existing.length && !existing.endsWith("\n") ? "\n" : "") + text);
    } else await this.io.write(file, text);
    return fresh.length;
  }

  // ---------- queries ----------
  list(): TrackerEvent[] {
    if (!this.cache) this.cache = [...this.byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    return this.cache;
  }
  get(id: string): TrackerEvent | undefined { return this.byId.get(id); }
  get size(): number { return this.byId.size; }
  hasExternal(externalId: string): string | undefined { return this.externals.get(externalId); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get undoLabel(): string | null { return this.undoStack[this.undoStack.length - 1]?.label ?? null; }

  // ---------- writing ----------
  private async write(ops: LogOp[]): Promise<void> {
    if (!ops.length) return;
    if (!(await this.io.exists(this.dir))) await this.io.mkdir(this.dir);
    const file = `${this.dir}/events-${this.now().getFullYear()}.jsonl`;
    let text = ops.map((o) => JSON.stringify(o)).join("\n") + "\n";
    if (this.needsNewline.has(file)) { text = "\n" + text; this.needsNewline.delete(file); }
    if (this.knownFiles.has(file) || (await this.io.exists(file))) await this.io.append(file, text);
    else await this.io.write(file, text);
    this.knownFiles.add(file);
    this.lastWriteAt = Date.now();
  }

  private mkOp<K extends LogOp["op"]>(op: K, rest: Omit<Extract<LogOp, { op: K }>, "v" | "op" | "at">): LogOp {
    return { v: this.target(), op, at: formatLocalIso(this.now()), ...rest } as unknown as LogOp;
  }

  private async commit(ops: LogOp[], undo: LogOp[] | null, label: string): Promise<Result<void>> {
    try { await this.write(ops); } catch (e) { return { ok: false, reason: "io", errors: [String(e)] }; }
    for (const op of ops) this.apply(op);
    if (undo) { this.undoStack.push({ ops: undo, label }); if (this.undoStack.length > 50) this.undoStack.shift(); }
    this.notify();
    return { ok: true, value: undefined };
  }

  private build(input: NewEvent): Result<TrackerEvent> {
    const nowIso = formatLocalIso(this.now());
    const v = validateEvent({ ...input, id: input.id ?? newId(), date: input.date ?? input.timestamp.slice(0, 10), createdAt: nowIso, updatedAt: nowIso });
    return v.ok ? { ok: true, value: v.event } : { ok: false, reason: "invalid", errors: v.errors };
  }

  async add(input: NewEvent, opts: { allowDuplicate?: boolean } = {}): Promise<Result<TrackerEvent>> {
    const b = this.build(input);
    if (!b.ok) return b;
    const ev = b.value;
    if (this.byId.has(ev.id)) return { ok: false, reason: "duplicate", errors: ["an event with this id already exists"], existingId: ev.id };
    if (ev.externalId && this.externals.has(ev.externalId)) return { ok: false, reason: "duplicate", errors: ["externalId already imported"], existingId: this.externals.get(ev.externalId) };
    const dup = this.fingerprints.get(eventFingerprint(ev));
    if (dup?.size && !opts.allowDuplicate) return { ok: false, reason: "duplicate", errors: ["an identical event already exists"], existingId: [...dup][0] };
    const r = await this.commit([this.mkOp("put", { event: ev })], [this.mkOp("delete", { id: ev.id })], "add event");
    return r.ok ? { ok: true, value: ev } : r;
  }

  async update(id: string, patch: Partial<Omit<TrackerEvent, "id" | "createdAt">>): Promise<Result<TrackerEvent>> {
    const old = this.byId.get(id);
    if (!old) return { ok: false, reason: "not-found", errors: ["event not found"] };
    const merged: Record<string, unknown> = { ...old, ...patch, id, createdAt: old.createdAt, updatedAt: formatLocalIso(this.now()) };
    if (patch.timestamp && !patch.date) merged.date = patch.timestamp.slice(0, 10);
    for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
    const v = validateEvent(merged);
    if (!v.ok) return { ok: false, reason: "invalid", errors: v.errors };
    const r = await this.commit([this.mkOp("put", { event: v.event })], [this.mkOp("put", { event: old })], "edit event");
    return r.ok ? { ok: true, value: v.event } : r;
  }

  async remove(id: string): Promise<Result<TrackerEvent>> {
    const old = this.byId.get(id);
    if (!old) return { ok: false, reason: "not-found", errors: ["event not found"] };
    const r = await this.commit([this.mkOp("delete", { id })], [this.mkOp("put", { event: old })], "delete event");
    return r.ok ? { ok: true, value: old } : r;
  }

  /** Renames a path prefix across all events (one log line). Returns the number of affected events. */
  async renamePath(from: string[], to: string[]): Promise<Result<number>> {
    const n = [...this.byId.values()].filter((e) => isPrefixPath(from, e.path)).length;
    if (!n) return { ok: true, value: 0 };
    const r = await this.commit([this.mkOp("rename", { from, to })], [this.mkOp("rename", { from: to, to: from })], "rename subject");
    return r.ok ? { ok: true, value: n } : r;
  }

  /** Creates or updates events keyed by externalId in a single write. Returns counts. */
  async upsertExternal(inputs: (NewEvent & { externalId: string })[]): Promise<Result<{ added: number; updated: number; unchanged: number }>> {
    const ops: LogOp[] = [], undo: LogOp[] = [];
    let added = 0, updated = 0, unchanged = 0;
    for (const input of inputs) {
      const existingId = this.externals.get(input.externalId);
      const old = existingId ? this.byId.get(existingId) : undefined;
      if (old) {
        if (old.durationMinutes === input.durationMinutes && old.path.join(",") === input.path.join(",")) { unchanged++; continue; }
        const b = this.build({ ...input, id: old.id });
        if (!b.ok) return b;
        ops.push(this.mkOp("put", { event: { ...b.value, createdAt: old.createdAt } })); undo.push(this.mkOp("put", { event: old })); updated++;
      } else {
        const b = this.build(input);
        if (!b.ok) return b;
        ops.push(this.mkOp("put", { event: b.value })); undo.push(this.mkOp("delete", { id: b.value.id })); added++;
      }
    }
    const r = await this.commit(ops, null, "sync");
    return r.ok ? { ok: true, value: { added, updated, unchanged } } : r;
  }

  /** Bulk import. Never overwrites: id clashes and identical fingerprints are skipped and counted; invalid rows are reported. */
  async addMany(rows: unknown[]): Promise<ImportReport> {
    const rep: ImportReport = { added: 0, duplicates: 0, conflicts: 0, invalid: [] };
    const ops: LogOp[] = [];
    const seenIds = new Set<string>(), seenFp = new Set<string>();
    const nowIso = formatLocalIso(this.now());
    rows.forEach((row, index) => {
      const v = validateEvent(normalizeRaw(row, nowIso));
      if (!v.ok) { rep.invalid.push({ index, errors: v.errors, raw: row }); return; }
      const ev = v.event;
      const fp = eventFingerprint(ev);
      const clash = this.byId.get(ev.id) ?? (seenIds.has(ev.id) ? ev : undefined);
      if (clash) { (clash !== ev && eventFingerprint(clash) === fp) || (clash === ev) ? rep.duplicates++ : rep.conflicts++; return; }
      if (this.fingerprints.has(fp) || seenFp.has(fp) || (ev.externalId && this.externals.has(ev.externalId))) { rep.duplicates++; return; }
      seenIds.add(ev.id); seenFp.add(fp);
      ops.push(this.mkOp("put", { event: ev }));
    });
    for (let i = 0; i < ops.length; i += 500) {
      const chunk = ops.slice(i, i + 500);
      const r = await this.commit(chunk, null, "import");
      if (!r.ok) { rep.invalid.push(...chunk.map((_, k) => ({ index: -1, errors: r.errors, raw: chunk[k] }))); break; }
      rep.added += chunk.length;
    }
    if (rep.added) this.undoStack.length = 0;
    return rep;
  }

  async undo(): Promise<{ ok: boolean; label?: string }> {
    const entry = this.undoStack.pop();
    if (!entry) return { ok: false };
    const r = await this.commit(entry.ops, null, entry.label);
    if (!r.ok) { this.undoStack.push(entry); return { ok: false }; }
    return { ok: true, label: entry.label };
  }
}

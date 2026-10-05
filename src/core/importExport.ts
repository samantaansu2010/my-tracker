/** JSON bundle and CSV import/export. Parsing never throws away rows: bad rows are returned for the caller to keep. */
import type { TrackerEvent, TrackerSettings } from "./types";
import { EVENT_SCHEMA_VERSION } from "./types";
import { formatLocalIso } from "./dates";
import { parseDuration } from "./duration";

export interface ExportBundle { app: "my-tracker"; schemaVersion: number; exportedAt: string; events: TrackerEvent[]; settings?: TrackerSettings }

export function buildBundle(events: TrackerEvent[], settings: TrackerSettings | undefined, now: Date): ExportBundle {
  return { app: "my-tracker", schemaVersion: EVENT_SCHEMA_VERSION, exportedAt: formatLocalIso(now), events, settings };
}

export function parseBundle(text: string): { events: unknown[]; settings?: unknown; error?: string } {
  let obj: unknown;
  try { obj = JSON.parse(text); } catch (e) { return { events: [], error: `Not valid JSON: ${String(e)}` }; }
  if (Array.isArray(obj)) return { events: obj };
  if (obj && typeof obj === "object" && Array.isArray((obj as ExportBundle).events)) {
    const b = obj as ExportBundle;
    if (typeof b.schemaVersion === "number" && b.schemaVersion > EVENT_SCHEMA_VERSION) return { events: [], error: `File was written by a newer version (schema v${b.schemaVersion}). Update My Tracker first.` };
    return { events: b.events, settings: b.settings };
  }
  return { events: [], error: "File does not look like a My Tracker export (no events array)." };
}

export const CSV_COLUMNS = ["id", "timestamp", "date", "category", "subject", "subsubject", "topic", "path", "duration_minutes", "kind", "result", "planned_minutes", "tags", "scores", "notes", "source"] as const;

const csvCell = (v: unknown): string => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function eventsToCsv(events: TrackerEvent[]): string {
  const rows = events.map((e) => [
    e.id, e.timestamp, e.date, e.path[0], e.path[1], e.path[2], e.path[3], e.path.join(" > "), e.durationMinutes, e.kind, e.result, e.plannedMinutes,
    e.tags.join(";"), e.scores ? Object.entries(e.scores).map(([k, v]) => `${k}=${v}`).join(";") : "", e.notes, e.source,
  ].map(csvCell).join(","));
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Converts CSV text into raw event-like objects. Unreadable rows become objects with an `__error` marker (reported, not dropped). */
export function csvToRawEvents(text: string, defaultUnit: "minutes" | "hours" = "minutes"): unknown[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (r: string[], ...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0 && (r[i] ?? "") !== "") return r[i].trim(); } return undefined; };
  return rows.slice(1).map((r) => {
    const out: Record<string, unknown> = {};
    const id = col(r, "id"); if (id) out.id = id;
    let ts = col(r, "timestamp");
    const date = col(r, "date"), time = col(r, "time");
    if (!ts && date) { const [h = "12", m = "00"] = (time ?? "12:00").split(":"); const [y, mo, d] = date.split("-").map(Number); ts = formatLocalIso(new Date(y, mo - 1, d, Number(h), Number(m))); }
    if (ts) out.timestamp = ts;
    if (date) out.date = date;
    const path = col(r, "path");
    if (path) out.path = path.split(/\s*>\s*/).filter(Boolean);
    else { out.category = col(r, "category"); out.subject = col(r, "subject"); out.subsubject = col(r, "subsubject"); out.topic = col(r, "topic"); }
    const mins = col(r, "duration_minutes", "durationminutes");
    const dur = col(r, "duration");
    out.durationMinutes = mins !== undefined ? Number(mins) : dur !== undefined ? parseDuration(dur, defaultUnit) ?? NaN : NaN;
    const planned = col(r, "planned_minutes", "plannedminutes"); if (planned) out.plannedMinutes = Number(planned);
    for (const k of ["kind", "result", "notes", "source"]) { const v = col(r, k); if (v !== undefined) out[k] = v; }
    const tags = col(r, "tags"); if (tags) out.tags = tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean);
    const scores = col(r, "scores");
    if (scores) { const o: Record<string, number> = {}; for (const part of scores.split(";")) { const [k, v] = part.split("="); if (k && v !== undefined && Number.isFinite(Number(v))) o[k.trim()] = Number(v); } out.scores = o; }
    out.source ??= "import";
    return out;
  });
}

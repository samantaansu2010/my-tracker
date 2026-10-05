/** Event validation, normalisation and duplicate fingerprints. */
import type { TrackerEvent } from "./types";
import { isDateKey } from "./dates";
import { SEP } from "./hierarchy";
import { newId } from "./ids";

export type Validation = { ok: true; event: TrackerEvent } | { ok: false; errors: string[] };

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const KNOWN = new Set(["id", "timestamp", "date", "path", "durationMinutes", "kind", "result", "scores", "plannedMinutes", "tags", "notes", "source", "externalId", "createdAt", "updatedAt", "extra"]);
export const MAX_PATH_DEPTH = 12;
export const MAX_DURATION_MINUTES = 24 * 60;

export function eventFingerprint(e: Pick<TrackerEvent, "timestamp" | "path" | "durationMinutes" | "kind" | "result" | "notes" | "source">): string {
  return [e.timestamp, e.path.join(SEP), e.durationMinutes, e.kind ?? "", e.result ?? "", e.notes, e.source].join("|");
}

/** Accepts legacy/loose shapes (category/subject/subsubject/topic fields instead of path) and fills defaults. */
export function normalizeRaw(raw: unknown, nowIso: string): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  if (!Array.isArray(r.path)) {
    const parts = [r.category, r.subject, r.subsubject, r.topic].filter((x): x is string => typeof x === "string" && x.trim() !== "");
    if (parts.length) r.path = parts;
  }
  delete r.category; delete r.subject; delete r.subsubject; delete r.topic;
  if (r.id === undefined || r.id === "") r.id = newId();
  if (typeof r.tags === "string") r.tags = (r.tags as string).split(/[;,]/).map((t) => t.trim()).filter(Boolean);
  r.createdAt ??= nowIso;
  r.updatedAt ??= r.createdAt;
  return r;
}

export function validateEvent(raw: unknown): Validation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["record is not an object"] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!id) errors.push("missing id");

  const timestamp = typeof r.timestamp === "string" ? r.timestamp.trim() : "";
  if (!TS_RE.test(timestamp) || !isDateKey(timestamp.slice(0, 10)) || Number.isNaN(Date.parse(timestamp))) errors.push("invalid timestamp");

  let date = typeof r.date === "string" ? r.date : "";
  if (!date && !errors.includes("invalid timestamp")) date = timestamp.slice(0, 10);
  if (!isDateKey(date)) errors.push("invalid date");

  let path: string[] = [];
  if (!Array.isArray(r.path) || r.path.length < 1 || r.path.length > MAX_PATH_DEPTH || r.path.some((s) => typeof s !== "string" || !s.trim() || s.includes(SEP))) errors.push("invalid path");
  else path = (r.path as string[]).map((s) => s.trim());

  const dur = r.durationMinutes;
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur <= 0 || dur > MAX_DURATION_MINUTES) errors.push("invalid durationMinutes (must be > 0 and <= 1440)");

  let planned: number | undefined;
  if (r.plannedMinutes !== undefined && r.plannedMinutes !== null) {
    if (typeof r.plannedMinutes !== "number" || !Number.isFinite(r.plannedMinutes) || r.plannedMinutes < 0) errors.push("invalid plannedMinutes");
    else planned = r.plannedMinutes;
  }

  let scores: Record<string, number> | undefined;
  if (r.scores !== undefined && r.scores !== null) {
    if (typeof r.scores !== "object" || Array.isArray(r.scores) || Object.values(r.scores as object).some((v) => typeof v !== "number" || !Number.isFinite(v))) errors.push("invalid scores");
    else scores = { ...(r.scores as Record<string, number>) };
  }

  if (errors.length) return { ok: false, errors };

  const tags = Array.isArray(r.tags) ? Array.from(new Set((r.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(Boolean))) : [];
  const extra: Record<string, unknown> = { ...(typeof r.extra === "object" && r.extra && !Array.isArray(r.extra) ? (r.extra as Record<string, unknown>) : {}) };
  for (const k of Object.keys(r)) if (!KNOWN.has(k)) extra[k] = r[k];

  const nowIso = timestamp;
  const event: TrackerEvent = {
    id, timestamp, date, path, durationMinutes: dur as number, tags,
    notes: typeof r.notes === "string" ? r.notes : "",
    source: typeof r.source === "string" && r.source ? r.source : "manual",
    createdAt: typeof r.createdAt === "string" ? r.createdAt : nowIso,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : nowIso,
  };
  if (typeof r.kind === "string" && r.kind.trim()) event.kind = r.kind.trim();
  if (typeof r.result === "string" && r.result.trim()) event.result = r.result.trim();
  if (scores && Object.keys(scores).length) event.scores = scores;
  if (planned !== undefined) event.plannedMinutes = planned;
  if (typeof r.externalId === "string" && r.externalId) event.externalId = r.externalId;
  if (Object.keys(extra).length) event.extra = extra;
  return { ok: true, event };
}

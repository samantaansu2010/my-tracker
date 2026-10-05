/**
 * Calendar arithmetic on "YYYY-MM-DD" keys (pure UTC math, so DST never changes a day's length) and
 * range resolution. A local Date is only used to obtain "today" and to express ranges as instants.
 */
import type { RangeSpec } from "./types";

export type DateKey = string;
const pad = (n: number, l = 2) => String(n).padStart(l, "0");

export function toDateKey(d: Date): DateKey {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function isDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
export function parseDateKey(k: DateKey): { y: number; m: number; d: number } {
  const [y, m, d] = k.split("-").map(Number);
  return { y, m, d };
}
export const dayNumber = (k: DateKey): number => {
  const { y, m, d } = parseDateKey(k);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export function fromDayNumber(n: number): DateKey {
  const d = new Date(n * 86400000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const addDays = (k: DateKey, n: number): DateKey => fromDayNumber(dayNumber(k) + n);
export const diffDays = (a: DateKey, b: DateKey): number => dayNumber(b) - dayNumber(a);
export const weekdayOf = (k: DateKey): number => new Date(dayNumber(k) * 86400000).getUTCDay();
export const startOfWeek = (k: DateKey, weekStartsOn: number): DateKey => addDays(k, -((weekdayOf(k) - weekStartsOn + 7) % 7));
export const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First day of the month `n` months away from k's month. */
export function shiftMonthStart(k: DateKey, n: number): DateKey {
  const { y, m } = parseDateKey(k);
  const total = y * 12 + (m - 1) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}-01`;
}
export const endOfMonth = (k: DateKey): DateKey => addDays(shiftMonthStart(k, 1), -1);
export const monthKey = (k: DateKey): string => k.slice(0, 7);

export function formatLocalIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? "+" : "-"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export const hourOf = (timestamp: string): number => parseInt(timestamp.slice(11, 13), 10);

// ---------- Range resolution ----------

export interface ResolveOpts { weekStartsOn: number; installDate?: string }
export type RangeKind = "day" | "rolling" | "week" | "month" | "year" | "open" | "custom";
/** start/end are inclusive date keys and describe the FULL period (end may be in the future). */
export interface DateRange { id: string; label: string; start: DateKey; end: DateKey; kind: RangeKind }

export const RANGE_LABELS: Record<string, string> = {
  today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last14: "Last 14 days", last30: "Last 30 days", last90: "Last 90 days",
  thisWeek: "This week", prevWeek: "Previous week", thisMonth: "This month", prevMonth: "Previous month",
  thisYear: "This year", prevYear: "Previous year", sinceJan1: "Since January 1", sinceInstall: "Since installation", custom: "Custom range",
};

export function resolveRange(spec: RangeSpec, today: DateKey, opts: ResolveOpts): DateRange {
  const rolling = (n: number): DateRange => ({ id: n === 7 || n === 14 || n === 30 || n === 90 ? `last${n}` : "lastN", label: `Last ${n} days`, start: addDays(today, -(n - 1)), end: today, kind: "rolling" });
  switch (spec.id) {
    case "today": return { id: "today", label: "Today", start: today, end: today, kind: "day" };
    case "yesterday": { const y = addDays(today, -1); return { id: "yesterday", label: "Yesterday", start: y, end: y, kind: "day" }; }
    case "last7": return rolling(7);
    case "last14": return rolling(14);
    case "last30": return rolling(30);
    case "last90": return rolling(90);
    case "lastN": return rolling(Math.max(1, Math.floor(spec.n ?? 7)));
    case "thisWeek": case "prevWeek": {
      const s = addDays(startOfWeek(today, opts.weekStartsOn), spec.id === "prevWeek" ? -7 : 0);
      return { id: spec.id, label: RANGE_LABELS[spec.id], start: s, end: addDays(s, 6), kind: "week" };
    }
    case "thisMonth": case "prevMonth": {
      const s = shiftMonthStart(today, spec.id === "prevMonth" ? -1 : 0);
      return { id: spec.id, label: RANGE_LABELS[spec.id], start: s, end: endOfMonth(s), kind: "month" };
    }
    case "thisYear": case "prevYear": {
      const y = parseDateKey(today).y - (spec.id === "prevYear" ? 1 : 0);
      return { id: spec.id, label: RANGE_LABELS[spec.id], start: `${pad(y, 4)}-01-01`, end: `${pad(y, 4)}-12-31`, kind: "year" };
    }
    case "sinceJan1": return { id: "sinceJan1", label: RANGE_LABELS.sinceJan1, start: `${pad(parseDateKey(today).y, 4)}-01-01`, end: today, kind: "open" };
    case "sinceInstall": {
      const s = opts.installDate && opts.installDate <= today ? opts.installDate : today;
      return { id: "sinceInstall", label: RANGE_LABELS.sinceInstall, start: s, end: today, kind: "open" };
    }
    case "custom": {
      let s = spec.custom?.start ?? today, e = spec.custom?.end ?? today;
      if (!isDateKey(s)) s = today;
      if (!isDateKey(e)) e = today;
      if (s > e) [s, e] = [e, s];
      return { id: "custom", label: `${s} → ${e}`, start: s, end: e, kind: "custom" };
    }
  }
}

/** The range clipped to `today` (the days that can contain data), or null if it starts in the future. */
export function elapsedRange(r: { start: DateKey; end: DateKey }, today: DateKey): { start: DateKey; end: DateKey } | null {
  if (r.start > today) return null;
  return { start: r.start, end: r.end > today ? today : r.end };
}
export function elapsedDays(r: { start: DateKey; end: DateKey }, today: DateKey): number {
  const e = elapsedRange(r, today);
  return e ? diffDays(e.start, e.end) + 1 : 0;
}
export const lengthDays = (r: { start: DateKey; end: DateKey }): number => diffDays(r.start, r.end) + 1;

/**
 * The comparison period. Rolling/day/open/custom: the same number of days immediately before.
 * Week/month/year: the previous calendar week/month/year. With `align`, a previous period longer than the
 * elapsed part of the current one is clipped to the same number of days (fair like-for-like comparison).
 */
export function previousRange(r: DateRange, today: DateKey, align = false): DateRange {
  let prev: DateRange;
  switch (r.kind) {
    case "week": prev = { id: "prev", label: "Previous week", start: addDays(r.start, -7), end: addDays(r.end, -7), kind: "week" }; break;
    case "month": { const s = shiftMonthStart(r.start, -1); prev = { id: "prev", label: "Previous month", start: s, end: endOfMonth(s), kind: "month" }; break; }
    case "year": { const y = parseDateKey(r.start).y - 1; prev = { id: "prev", label: "Previous year", start: `${pad(y, 4)}-01-01`, end: `${pad(y, 4)}-12-31`, kind: "year" }; break; }
    default: { const len = lengthDays(r); prev = { id: "prev", label: `Previous ${len} day${len === 1 ? "" : "s"}`, start: addDays(r.start, -len), end: addDays(r.start, -1), kind: r.kind }; }
  }
  if (align && r.end > today) {
    const el = elapsedDays(r, today);
    if (el > 0 && lengthDays(prev) > el) prev = { ...prev, end: addDays(prev.start, el - 1) };
  }
  return prev;
}

/** Window for target tracking: `offset` periods away from the current one (0 = current, -1 = previous ...). */
export function periodRange(kind: "day" | "week" | "month", today: DateKey, weekStartsOn: number, offset = 0): DateRange {
  if (kind === "day") { const d = addDays(today, offset); return { id: "day", label: d, start: d, end: d, kind: "day" }; }
  if (kind === "week") { const s = addDays(startOfWeek(today, weekStartsOn), offset * 7); return { id: "week", label: `Week of ${s}`, start: s, end: addDays(s, 6), kind: "week" }; }
  const s = shiftMonthStart(today, offset);
  return { id: "month", label: s.slice(0, 7), start: s, end: endOfMonth(s), kind: "month" };
}

/** Exact local instants [startMs, endMs) for a range (end is midnight after the last day). */
export function rangeInstants(r: { start: DateKey; end: DateKey }): { startMs: number; endMs: number } {
  const s = parseDateKey(r.start), e = parseDateKey(r.end);
  return { startMs: new Date(s.y, s.m - 1, s.d).getTime(), endMs: new Date(e.y, e.m - 1, e.d + 1).getTime() };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDateKey(k: DateKey, fmt: string): string {
  const { y, m, d } = parseDateKey(k);
  switch (fmt) {
    case "DD/MM/YYYY": return `${pad(d)}/${pad(m)}/${pad(y, 4)}`;
    case "MM/DD/YYYY": return `${pad(m)}/${pad(d)}/${pad(y, 4)}`;
    case "D MMM YYYY": return `${d} ${MON[m - 1]} ${y}`;
    default: return k;
  }
}
export function formatTime(timestamp: string, fmt: "24h" | "12h"): string {
  const h = parseInt(timestamp.slice(11, 13), 10), m = timestamp.slice(14, 16);
  if (fmt === "24h") return `${pad(h)}:${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** Compact label for chart axes that follows the user's date format: "09-29", "29/09", "09/29" or "29 Sep". */
export function formatShortDate(k: DateKey, fmt: string): string {
  const { m, d } = parseDateKey(k);
  switch (fmt) {
    case "DD/MM/YYYY": return `${pad(d)}/${pad(m)}`;
    case "MM/DD/YYYY": return `${pad(m)}/${pad(d)}`;
    case "D MMM YYYY": return `${d} ${MON[m - 1]}`;
    default: return `${pad(m)}-${pad(d)}`;
  }
}
/** Month label for chart axes from a "YYYY-MM" key: "2026-09", "09/2026" or "Sep 2026". */
export function formatMonthLabel(key: string, fmt: string): string {
  const [y, m] = key.split("-").map(Number);
  if (fmt === "D MMM YYYY") return `${MON[m - 1]} ${y}`;
  if (fmt === "DD/MM/YYYY" || fmt === "MM/DD/YYYY") return `${pad(m)}/${y}`;
  return key;
}

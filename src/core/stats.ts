/**
 * Analytics engine. Pure functions over raw events; nothing here is stored.
 * Definitions (all day-based math uses the stored local `date`):
 *  - calendarDays = days from range.start to min(range.end, today), inclusive. Future days never count.
 *  - activeDays   = distinct dates with >= 1 event in range.
 *  - consistency  = activeDays / calendarDays (null when calendarDays = 0).
 *  - avgPerCalendarDay = total / calendarDays; avgPerActiveDay = total / activeDays.
 *  - avgSession / medianSession are over individual event durations.
 *  - longestGap   = largest number of fully idle days between two consecutive active dates in range.
 *  - currentStreak = consecutive active days ending on the last elapsed day (a still-empty "today" doesn't break it).
 *  - trend        = least-squares slope of daily minutes over calendarDays (needs >= 7 days AND >= 3 active days).
 */
import type { SubjectNode, TrackerEvent } from "./types";
import { addDays, diffDays, hourOf, monthKey, shiftMonthStart, startOfWeek, weekdayOf, type DateKey } from "./dates";
import { SEP, flatten, isPrefixPath } from "./hierarchy";

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const filterByPath = (events: TrackerEvent[], path: string[]): TrackerEvent[] => (path.length ? events.filter((e) => isPrefixPath(path, e.path)) : events);
export const filterByRange = (events: TrackerEvent[], start: DateKey, end: DateKey): TrackerEvent[] => events.filter((e) => e.date >= start && e.date <= end);

export interface DailyPoint { date: DateKey; minutes: number; sessions: number }
/** One point per calendar day in [start, end], zero-filled. */
export function dailySeries(events: TrackerEvent[], start: DateKey, end: DateKey): DailyPoint[] {
  const map = new Map<DateKey, DailyPoint>();
  for (let d = start; d <= end; d = addDays(d, 1)) map.set(d, { date: d, minutes: 0, sessions: 0 });
  for (const e of events) { const p = map.get(e.date); if (p) { p.minutes += e.durationMinutes; p.sessions++; } }
  return [...map.values()];
}

export type Granularity = "day" | "week" | "month";
export interface Bucket { key: string; start: DateKey; end: DateKey; minutes: number; sessions: number }
/** Start date of the day/week/month bucket that contains `d`. */
export const bucketStartOf = (d: DateKey, gran: Granularity, weekStartsOn: number): DateKey => (gran === "day" ? d : gran === "week" ? startOfWeek(d, weekStartsOn) : d.slice(0, 8) + "01");
export function bucketSeries(events: TrackerEvent[], start: DateKey, end: DateKey, gran: Granularity, weekStartsOn: number): Bucket[] {
  const startOf = (d: DateKey) => bucketStartOf(d, gran, weekStartsOn);
  const nextOf = (s: DateKey) => (gran === "day" ? addDays(s, 1) : gran === "week" ? addDays(s, 7) : shiftMonthStart(s, 1));
  const buckets = new Map<DateKey, Bucket>();
  for (let s = startOf(start); s <= end; s = nextOf(s)) buckets.set(s, { key: gran === "month" ? monthKey(s) : s, start: s, end: addDays(nextOf(s), -1), minutes: 0, sessions: 0 });
  for (const e of events) {
    if (e.date < start || e.date > end) continue;
    const b = buckets.get(startOf(e.date));
    if (b) { b.minutes += e.durationMinutes; b.sessions++; }
  }
  return [...buckets.values()];
}

export function movingAverage(values: number[], window: number): (number | null)[] {
  const w = Math.max(1, Math.floor(window));
  return values.map((_, i) => (i + 1 < w ? null : sum(values.slice(i + 1 - w, i + 1)) / w));
}
export function cumulative(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

export interface Trend {
  status: "ok" | "insufficient";
  direction?: "up" | "down" | "flat";
  slopePerDay?: number;
  weeklyChangeMinutes?: number;
  /** slope × (n−1) ÷ mean: fitted change across the range relative to the average day; null if mean = 0 */
  relativeChange?: number | null;
  r2?: number | null;
}
export function computeTrend(values: number[], flatThreshold = 0.1): Trend {
  const n = values.length;
  if (n < 7) return { status: "insufficient" };
  const xm = (n - 1) / 2, ym = sum(values) / n;
  let sxy = 0, sxx = 0, syy = 0;
  values.forEach((y, x) => { sxy += (x - xm) * (y - ym); sxx += (x - xm) ** 2; syy += (y - ym) ** 2; });
  const slope = sxy / sxx;
  const rel = ym > 0 ? (slope * (n - 1)) / ym : null;
  const direction = rel === null || Math.abs(rel) < flatThreshold ? "flat" : rel > 0 ? "up" : "down";
  return { status: "ok", direction, slopePerDay: slope, weeklyChangeMinutes: slope * 7, relativeChange: rel, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : null };
}

export interface GapInfo { from: DateKey; to: DateKey; days: number }
/** Idle stretches between consecutive active dates, largest first. `days` counts only the fully idle days between. */
export function topGaps(activeDates: DateKey[], n = 3): GapInfo[] {
  const u = Array.from(new Set(activeDates)).sort();
  const gaps: GapInfo[] = [];
  for (let i = 1; i < u.length; i++) {
    const days = diffDays(u[i - 1], u[i]) - 1;
    if (days > 0) gaps.push({ from: addDays(u[i - 1], 1), to: addDays(u[i], -1), days });
  }
  return gaps.sort((a, b) => b.days - a.days).slice(0, n);
}
export const topSessions = (events: TrackerEvent[], n = 5): TrackerEvent[] => [...events].sort((a, b) => b.durationMinutes - a.durationMinutes || b.timestamp.localeCompare(a.timestamp)).slice(0, n);

function streaks(active: Set<DateKey>, sorted: DateKey[], lastDay: DateKey, today: DateKey): { current: number; longest: number } {
  let longest = 0, run = 0, prev: DateKey | null = null;
  for (const d of sorted) { run = prev && diffDays(prev, d) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }
  let end = lastDay;
  if (lastDay === today && !active.has(today)) end = addDays(today, -1);
  let current = 0;
  for (let d = end; active.has(d); d = addDays(d, -1)) current++;
  return { current, longest };
}

const PERIODS = [
  { label: "Night (00–06)", from: 0, to: 5 }, { label: "Morning (06–12)", from: 6, to: 11 },
  { label: "Afternoon (12–18)", from: 12, to: 17 }, { label: "Evening (18–24)", from: 18, to: 23 },
];

export interface Stats {
  start: DateKey; end: DateKey; calendarDays: number;
  totalMinutes: number; totalHours: number; sessions: number; activeDays: number;
  consistency: number | null; avgPerCalendarDay: number | null; avgPerActiveDay: number | null;
  avgSession: number | null; medianSession: number | null;
  longestSession: TrackerEvent | null; shortestSession: TrackerEvent | null;
  longestGap: GapInfo | null; firstDate: DateKey | null; lastDate: DateKey | null; daysSinceLast: number | null;
  weeklyAverage: number | null; monthlyAverage: number | null;
  currentStreak: number; longestStreak: number;
  peakDay: { date: DateKey; minutes: number } | null;
  peakWeekday: { weekday: number; minutes: number } | null;
  peakPeriod: { label: string; minutes: number } | null;
  planned: { plannedMinutes: number; actualMinutes: number; sessions: number; ratio: number | null };
  trend: Trend;
  excludedFuture: number;
}

export function computeStats(events: TrackerEvent[], range: { start: DateKey; end: DateKey }, today: DateKey, trendThreshold = 0.1): Stats {
  const start = range.start;
  const end = range.end > today ? today : range.end;
  const calendarDays = end >= start ? diffDays(start, end) + 1 : 0;
  const inRange = calendarDays ? filterByRange(events, start, end) : [];
  const excludedFuture = events.filter((e) => e.date > today && e.date >= start && e.date <= range.end).length;

  const perDay = new Map<DateKey, number>();
  for (const e of inRange) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.durationMinutes);
  const sortedDays = [...perDay.keys()].sort();
  const durations = inRange.map((e) => e.durationMinutes);
  const total = sum(durations);
  const activeDays = perDay.size;

  let longest: TrackerEvent | null = null, shortest: TrackerEvent | null = null;
  for (const e of inRange) {
    if (!longest || e.durationMinutes > longest.durationMinutes) longest = e;
    if (!shortest || e.durationMinutes < shortest.durationMinutes) shortest = e;
  }
  const lastDate = sortedDays.length ? sortedDays[sortedDays.length - 1] : null;
  const st = streaks(new Set(sortedDays), sortedDays, end, today);

  let peakDay: Stats["peakDay"] = null;
  for (const [date, minutes] of perDay) if (!peakDay || minutes > peakDay.minutes || (minutes === peakDay.minutes && date < peakDay.date)) peakDay = { date, minutes };

  const byWeekday = new Array<number>(7).fill(0);
  for (const [d, m] of perDay) byWeekday[weekdayOf(d)] += m;
  let peakWeekday: Stats["peakWeekday"] = null;
  byWeekday.forEach((m, weekday) => { if (m > 0 && (!peakWeekday || m > peakWeekday.minutes)) peakWeekday = { weekday, minutes: m }; });

  // Peak period uses real session start times, so daily aggregates imported from integrations are excluded.
  const byPeriod = PERIODS.map(() => 0);
  for (const e of inRange) if (e.source !== "activitywatch") { const h = hourOf(e.timestamp); const i = PERIODS.findIndex((p) => h >= p.from && h <= p.to); if (i >= 0) byPeriod[i] += e.durationMinutes; }
  let peakPeriod: Stats["peakPeriod"] = null;
  byPeriod.forEach((m, i) => { if (m > 0 && (!peakPeriod || m > peakPeriod.minutes)) peakPeriod = { label: PERIODS[i].label, minutes: m }; });

  const withPlan = inRange.filter((e) => e.plannedMinutes !== undefined && e.plannedMinutes > 0);
  const plannedMinutes = sum(withPlan.map((e) => e.plannedMinutes!));
  const actualMinutes = sum(withPlan.map((e) => e.durationMinutes));

  const perCal = calendarDays ? total / calendarDays : null;
  return {
    start, end, calendarDays, totalMinutes: total, totalHours: total / 60, sessions: inRange.length, activeDays,
    consistency: calendarDays ? activeDays / calendarDays : null,
    avgPerCalendarDay: perCal, avgPerActiveDay: activeDays ? total / activeDays : null,
    avgSession: inRange.length ? total / inRange.length : null, medianSession: median(durations),
    longestSession: longest, shortestSession: shortest,
    longestGap: topGaps(sortedDays, 1)[0] ?? null,
    firstDate: sortedDays[0] ?? null, lastDate, daysSinceLast: lastDate ? diffDays(lastDate, today) : null,
    weeklyAverage: perCal === null ? null : perCal * 7, monthlyAverage: perCal === null ? null : perCal * (365.2425 / 12),
    currentStreak: st.current, longestStreak: st.longest, peakDay, peakWeekday, peakPeriod,
    planned: { plannedMinutes, actualMinutes, sessions: withPlan.length, ratio: plannedMinutes > 0 ? actualMinutes / plannedMinutes : null },
    trend: calendarDays && activeDays >= 3 ? computeTrend(dailySeries(inRange, start, end).map((p) => p.minutes), trendThreshold) : { status: "insufficient" },
    excludedFuture,
  };
}

// ---------- hierarchy aggregation ----------

export interface RollupEntry { path: string[]; minutes: number; sessions: number; lastDate: DateKey | null }
/** Totals for EVERY path prefix: an event at A>B>C contributes to A, A>B and A>B>C. Parents are never entered by hand. */
export function rollup(events: TrackerEvent[], tree?: SubjectNode[]): Map<string, RollupEntry> {
  const map = new Map<string, RollupEntry>();
  const get = (path: string[]): RollupEntry => {
    const k = path.join(SEP);
    let r = map.get(k);
    if (!r) { r = { path, minutes: 0, sessions: 0, lastDate: null }; map.set(k, r); }
    return r;
  };
  if (tree) for (const f of flatten(tree)) get(f.path);
  for (const e of events) {
    for (let i = 1; i <= e.path.length; i++) {
      const r = get(e.path.slice(0, i));
      r.minutes += e.durationMinutes; r.sessions++;
      if (!r.lastDate || e.date > r.lastDate) r.lastDate = e.date;
    }
  }
  return map;
}

export interface Slice { name: string; path: string[]; minutes: number; sessions: number; share: number | null }
/** Breakdown of the direct children below `prefix` ([] = categories). Events sitting exactly at `prefix` are "(direct)". */
export function distribution(events: TrackerEvent[], prefix: string[]): Slice[] {
  const scoped = filterByPath(events, prefix);
  const total = sum(scoped.map((e) => e.durationMinutes));
  const groups = new Map<string, Slice>();
  for (const e of scoped) {
    const name = e.path[prefix.length] ?? "(direct)";
    const g = groups.get(name) ?? { name, path: e.path[prefix.length] ? [...prefix, name] : prefix, minutes: 0, sessions: 0, share: null };
    g.minutes += e.durationMinutes; g.sessions++;
    groups.set(name, g);
  }
  return [...groups.values()].map((g) => ({ ...g, share: total > 0 ? g.minutes / total : null })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

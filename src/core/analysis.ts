/**
 * Analysis workspace model. Pure functions only: every number is derived on demand from the raw events using the
 * existing engine (computeStats, bucketSeries, compareStats, previousRange …). Nothing here is stored.
 *
 * Conventions
 *  - Range data are cut at `today` (future days never count), exactly like the dashboard.
 *  - ActivityWatch records are daily totals per app: they count towards time, heatmap and subjects, but are NOT
 *    sessions, so session statistics always exclude them. The whole workspace can also exclude them.
 *  - An insight is produced only when its minimum-data rule (MIN_DATA) is met; otherwise it is omitted.
 *  - Pattern insights (consistency, weekday, weeks, streak, gap) only look at days since the first tracked event, so a
 *    range reaching back before tracking began never counts empty pre-tracking days as 'inactive'.
 */
import type { SubjectNode, TrackerEvent } from "./types";
import { addDays, diffDays, startOfWeek, weekdayOf, type DateKey, type DateRange } from "./dates";
import { bucketSeries, computeStats, cumulative, filterByRange, median, movingAverage, sum, topSessions, type Bucket, type Granularity, type Slice, type Stats } from "./stats";
import { compareStats, type Comparison } from "./compare";
import { flatten, pathKey, pathLabel } from "./hierarchy";
import { formatDuration, formatPercent, formatPercentChange, formatSignedDuration } from "./duration";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const MIN_DATA = {
  /** sessions needed before session-length insights */
  sessions: 3,
  /** elapsed days / active days / complete weeks needed before "pattern" insights (weekday, week) */
  patternDays: 14, patternActiveDays: 7, patternWeeks: 4,
  /** minutes of data and number of groups before composition insights */
  compositionMinutes: 60,
  /** active days before "biggest day" / streak insights */
  peakActiveDays: 3, streakDays: 7, consistencyActiveDays: 2,
  /** smallest change (minutes) in one subject that is worth calling a rise or a drop */
  moverMinutes: 15,
  /** sessions with a planned time before a planned-versus-actual insight */
  plannedSessions: 3,
} as const;

// ---------------------------------------------------------------- filters

export function eventFilter(o: { scope: string[]; includeActivityWatch: boolean }): (e: TrackerEvent) => boolean {
  return (e) => (o.includeActivityWatch || e.source !== "activitywatch") && o.scope.every((s, i) => e.path[i] === s);
}

export interface ScopeOption { key: string; label: string; path: string[]; depth: number }
/** "All activity" + every subject in the tree + subjects that only exist in past events (e.g. removed from the tree). */
export function scopeOptions(tree: SubjectNode[], events: TrackerEvent[]): ScopeOption[] {
  const out: ScopeOption[] = [{ key: "", label: "All activity", path: [], depth: 0 }];
  const seen = new Set<string>([""]);
  for (const f of flatten(tree)) { const k = pathKey(f.path); seen.add(k); out.push({ key: k, label: f.node.name, path: f.path, depth: f.path.length - 1 }); }
  for (const e of events) for (let i = 1; i <= e.path.length; i++) {
    const p = e.path.slice(0, i), k = pathKey(p);
    if (!seen.has(k)) { seen.add(k); out.push({ key: k, label: `${pathLabel(p)} (not in subject list)`, path: p, depth: i - 1 }); }
  }
  return out;
}

export const autoGranularity = (calendarDays: number): Granularity => (calendarDays <= 62 ? "day" : calendarDays <= 400 ? "week" : "month");

// ---------------------------------------------------------------- grouping (subjects / composition)

/** Groups events by their path segment at `depth` (0 = category, 1 = subject, …), keeping the full path to that level. */
export function groupAtDepth(events: TrackerEvent[], depth: number): Slice[] {
  const total = sum(events.map((e) => e.durationMinutes));
  const groups = new Map<string, Slice>();
  for (const e of events) {
    const has = e.path.length > depth;
    const path = has ? e.path.slice(0, depth + 1) : e.path;
    const key = has ? pathKey(path) : `${pathKey(path)}\u0000direct`;
    const g = groups.get(key) ?? { name: has ? path[depth] : "(direct)", path, minutes: 0, sessions: 0, share: null };
    g.minutes += e.durationMinutes; g.sessions++;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g, share: total > 0 ? g.minutes / total : null })).sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

export interface Composition { slices: Slice[]; donut: boolean; reason?: string }
/**
 * Composition for a donut. More than `max` groups are folded into "Other". A donut is only recommended when it
 * stays readable: 2–`max` slices and "Other" not dominating (≤ 40%); otherwise the bar chart is the better view.
 */
export function compositionSlices(groups: Slice[], max = 6): Composition {
  const sorted = [...groups].filter((g) => g.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  if (sorted.length < 2) return { slices: sorted, donut: false, reason: "Needs at least two groups to show a composition." };
  let slices = sorted;
  if (sorted.length > max) {
    const head = sorted.slice(0, max - 1), rest = sorted.slice(max - 1);
    const total = sum(sorted.map((g) => g.minutes));
    const other = sum(rest.map((g) => g.minutes));
    slices = [...head, { name: "Other", path: [], minutes: other, sessions: sum(rest.map((g) => g.sessions)), share: total > 0 ? other / total : null }];
    if ((slices[slices.length - 1].share ?? 0) > 0.4) return { slices, donut: false, reason: "Too many small groups for a donut — the bar chart shows them all." };
  }
  return { slices, donut: true };
}

// ---------------------------------------------------------------- heatmap

export interface HeatCell { date: DateKey; minutes: number; level: 0 | 1 | 2 | 3 | 4; inRange: boolean }
export interface Heatmap {
  /** one entry per week column; each column holds the days of that week up to the last day with data */
  columns: HeatCell[][];
  /** weekday number (0=Sun) of each row, starting with the configured first day of the week */
  rowWeekdays: number[];
  monthStarts: { col: number; key: string }[];
  thresholds: number[]; weeks: number; capped: boolean;
  start: DateKey; end: DateKey;
  /** every displayed day (the whole window, including dimmed context days) */
  summary: { elapsedDays: number; activeDays: number; consistency: number | null; maxMinutes: number };
  /** only the days inside the selected range — matches the KPI numbers */
  rangeSummary: { elapsedDays: number; activeDays: number; consistency: number | null };
}
export const HEATMAP_MIN_WEEKS = 26;
export const HEATMAP_MAX_WEEKS = 53;

const quantile = (sorted: number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
/**
 * Upper bounds of intensity levels 1–3 (level 4 is anything above the third bound). Quartiles of the non-zero days;
 * with fewer than 4 active days, or when the quartiles collapse (all days alike), a linear scale on the maximum is used.
 */
export function intensityThresholds(nonZeroMinutes: number[]): number[] {
  const v = nonZeroMinutes.filter((m) => m > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const max = v[v.length - 1];
  const linear = [max / 4, max / 2, (3 * max) / 4];
  if (v.length < 4) return linear;
  const q = [quantile(v, 0.25), quantile(v, 0.5), quantile(v, 0.75)];
  return q[0] === q[2] ? linear : q;
}
export function intensityLevel(minutes: number, thresholds: number[]): 0 | 1 | 2 | 3 | 4 {
  if (!(minutes > 0)) return 0;
  return Math.min(4, 1 + thresholds.filter((t) => t < minutes).length) as 1 | 2 | 3 | 4;
}

/**
 * GitHub-style grid. The window covers the selected range but is never shorter than 26 weeks (so "Today" still has
 * context) nor longer than 53 weeks (the most recent 53 are shown for very long ranges). Days outside the selected
 * range are included but flagged `inRange: false` so the view can dim them.
 */
export function buildHeatmap(events: TrackerEvent[], range: { start: DateKey; end: DateKey }, today: DateKey, weekStartsOn: number): Heatmap {
  const end = range.end > today ? today : range.end;
  const lastWeekStart = startOfWeek(end, weekStartsOn);
  const needed = Math.max(1, Math.floor(diffDays(startOfWeek(range.start, weekStartsOn), lastWeekStart) / 7) + 1);
  const weeks = Math.min(HEATMAP_MAX_WEEKS, Math.max(HEATMAP_MIN_WEEKS, needed));
  const first = addDays(lastWeekStart, -(weeks - 1) * 7);
  const perDay = new Map<DateKey, number>();
  for (const e of events) if (e.date >= first && e.date <= end) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.durationMinutes);
  const thresholds = intensityThresholds([...perDay.values()]);
  const columns: HeatCell[][] = [];
  const monthStarts: { col: number; key: string }[] = [];
  let prevMonth = "", active = 0, elapsed = 0, max = 0, rActive = 0, rElapsed = 0;
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(first, w * 7 + d);
      if (date > end) break;
      const minutes = perDay.get(date) ?? 0;
      col.push({ date, minutes, level: intensityLevel(minutes, thresholds), inRange: date >= range.start && date <= end });
      elapsed++; if (minutes > 0) active++; max = Math.max(max, minutes);
      if (date >= range.start) { rElapsed++; if (minutes > 0) rActive++; }
    }
    if (!col.length) break;
    const month = col[0].date.slice(0, 7);
    if (month !== prevMonth) { monthStarts.push({ col: w, key: month }); prevMonth = month; }
    columns.push(col);
  }
  return {
    columns, rowWeekdays: Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7), monthStarts, thresholds, weeks, capped: needed > HEATMAP_MAX_WEEKS,
    start: first, end, summary: { elapsedDays: elapsed, activeDays: active, consistency: elapsed ? active / elapsed : null, maxMinutes: max },
    rangeSummary: { elapsedDays: rElapsed, activeDays: rActive, consistency: rElapsed ? rActive / rElapsed : null },
  };
}

/**
 * Wording for the heatmap card. Short ranges still draw a window of context (at least 26 weeks), so the caption says
 * which days the numbers cover instead of silently quoting the window.
 */
export function heatmapCaption(h: Heatmap): string {
  const long = h.rangeSummary.elapsedDays >= 14;
  const sum = long ? h.rangeSummary : h.summary;
  const days = `${sum.activeDays} of ${sum.elapsedDays} days active`;
  if (long) return h.capped ? `${days} \u00b7 latest ${h.weeks} weeks` : days;
  return `${days} \u00b7 last ${h.weeks} weeks shown for context`;
}

/**
 * Y axis for a chart of whole-number counts: only integer ticks (never "1, 1, 0" from rounding 0.5), at most 5 intervals.
 */
export function countAxis(maxCount: number): { max: number; ticks: number[] } {
  const top = Math.max(1, Math.ceil(Number.isFinite(maxCount) ? maxCount : 1));
  if (top <= 4) return { max: top, ticks: Array.from({ length: top + 1 }, (_, i) => i) };
  let step = 1;
  for (let pow = 1; ; pow *= 10) {
    const hit = [1, 2, 5].map((m) => m * pow).find((c) => Math.ceil(top / c) <= 5);
    if (hit) { step = hit; break; }
  }
  const max = Math.ceil(top / step) * step;
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

// ---------------------------------------------------------------- sessions

export interface HistBin { label: string; min: number; max: number; count: number }
export const SESSION_BINS: { label: string; min: number; max: number }[] = [
  { label: "< 15m", min: 0, max: 15 }, { label: "15–30m", min: 15, max: 30 }, { label: "30–60m", min: 30, max: 60 },
  { label: "1–1.5h", min: 60, max: 90 }, { label: "1.5–2h", min: 90, max: 120 }, { label: "2–3h", min: 120, max: 180 }, { label: "3h+", min: 180, max: Infinity },
];
/** Bins are half-open [min, max): a 15-minute session belongs to "15–30m". */
export function sessionHistogram(durations: number[]): HistBin[] {
  const bins = SESSION_BINS.map((b) => ({ ...b, count: 0 }));
  for (const d of durations) { const b = bins.find((x) => d >= x.min && d < x.max); if (b) b.count++; }
  return bins;
}
export interface SessionAnalysis { count: number; totalMinutes: number; averageMinutes: number | null; medianMinutes: number | null; longest: TrackerEvent | null; shortest: TrackerEvent | null; histogram: HistBin[]; excludedDailyTotals: number }
export function analyseSessions(events: TrackerEvent[]): SessionAnalysis {
  const sessions = events.filter((e) => e.source !== "activitywatch");
  const durations = sessions.map((e) => e.durationMinutes);
  const total = sum(durations);
  return {
    count: sessions.length, totalMinutes: total, averageMinutes: sessions.length ? total / sessions.length : null, medianMinutes: median(durations),
    longest: topSessions(sessions, 1)[0] ?? null, shortest: sessions.reduce<TrackerEvent | null>((m, e) => (!m || e.durationMinutes < m.durationMinutes ? e : m), null),
    histogram: sessionHistogram(durations), excludedDailyTotals: events.length - sessions.length,
  };
}

// ---------------------------------------------------------------- model

export interface AnalysisInput {
  events: TrackerEvent[]; scope: string[]; range: DateRange; prev: DateRange; today: DateKey; weekStartsOn: number;
  includeActivityWatch: boolean; granularity?: Granularity; fmtDate?: (d: DateKey) => string;
}
export interface Insight { id: string; text: string; tone?: "up" | "down"; drill?: { title: string; start: DateKey; end: DateKey; path: string[] } }
export interface AnalysisModel {
  filter: (e: TrackerEvent) => boolean;
  events: TrackerEvent[]; stats: Stats; prevStats: Stats; comparison: Comparison; hasData: boolean;
  /** date of the first event matching the current filters (null if none) */
  trackingStart: DateKey | null;
  granularity: Granularity;
  activity: { buckets: Bucket[]; partial: boolean[]; movingAverage: (number | null)[]; window: number };
  heatmap: Heatmap;
  subjects: Slice[]; subjectDepth: number; composition: Composition;
  /** the same grouping for the previous period (empty when there is none) */
  previousSubjects: Slice[];
  sessions: SessionAnalysis;
  previousSessions: SessionAnalysis;
  periods: { current: number[]; previous: number[]; granularity: Granularity };
  /** sessions in the selected and previous period (ActivityWatch daily totals excluded) */
  sessionCounts: { current: number; previous: number };
  insights: Insight[];
}

export function buildAnalysis(input: AnalysisInput): AnalysisModel {
  const { today, weekStartsOn: ws, scope } = input;
  const filter = eventFilter(input);
  const base = input.events.filter(filter);
  const stats = computeStats(base, input.range, today), prevStats = computeStats(base, input.prev, today);
  const events = stats.calendarDays ? filterByRange(base, input.range.start, stats.end) : [];
  const granularity = input.granularity ?? autoGranularity(stats.calendarDays);

  const buckets = stats.calendarDays ? bucketSeries(base, input.range.start, stats.end, granularity, ws) : [];
  const window = granularity === "day" ? 7 : granularity === "week" ? 4 : 0;
  const activity = {
    buckets, window,
    partial: buckets.map((b) => b.start < input.range.start || b.end > stats.end),
    movingAverage: window ? movingAverage(buckets.map((b) => b.minutes), window) : buckets.map(() => null),
  };
  const prevBuckets = prevStats.calendarDays ? bucketSeries(base, input.prev.start, prevStats.end, granularity, ws) : [];
  const periods = { current: cumulative(buckets.map((b) => b.minutes)), previous: cumulative(prevBuckets.map((b) => b.minutes)), granularity };

  const subjectDepth = scope.length === 0 ? 1 : scope.length;
  const subjects = groupAtDepth(events, subjectDepth);
  const composition = compositionSlices(groupAtDepth(events, scope.length));
  const sessions = analyseSessions(events);
  const comparison = compareStats(stats, prevStats);

  const trackingStart = base.reduce<DateKey | null>((m, e) => (m === null || e.date < m ? e.date : m), null);
  const prevEvents = prevStats.calendarDays ? filterByRange(base, input.prev.start, prevStats.end) : [];
  const sessionCounts = { current: sessions.count, previous: prevEvents.filter((e) => e.source !== "activitywatch").length };
  const previousSubjects = groupAtDepth(prevEvents, subjectDepth), previousSessions = analyseSessions(prevEvents);
  const partial = { filter, events, stats, prevStats, comparison, hasData: events.length > 0, trackingStart, granularity, activity, heatmap: buildHeatmap(base, input.range, today, ws), subjects, subjectDepth, composition, previousSubjects, sessions, previousSessions, periods, sessionCounts };
  return { ...partial, insights: buildInsights(partial, input, base) };
}

// ---------------------------------------------------------------- subject changes

export interface SubjectChange { name: string; path: string[]; current: number; previous: number; diff: number; pct: number | null; kind: "new" | "gone" | "pct" | "flat" }
/**
 * Current against previous minutes per subject. Subjects that exist in only one period are kept: "new" (nothing
 * before) and "gone" (nothing now) are real changes, but they have no percentage — a percentage of zero is never invented.
 */
export function subjectChanges(current: Slice[], previous: Slice[]): SubjectChange[] {
  const prev = new Map(previous.map((p) => [pathKey(p.path), p]));
  const seen = new Set<string>(), out: SubjectChange[] = [];
  const row = (name: string, path: string[], cur: number, pre: number): SubjectChange => {
    const diff = cur - pre;
    const kind: SubjectChange["kind"] = pre <= 0 && cur > 0 ? "new" : cur <= 0 && pre > 0 ? "gone" : Math.abs(diff) < 1e-9 ? "flat" : "pct";
    return { name, path, current: cur, previous: pre, diff, pct: pre > 0 ? (diff / pre) * 100 : null, kind };
  };
  for (const c of current) { const k = pathKey(c.path); seen.add(k); out.push(row(c.name, c.path, c.minutes, prev.get(k)?.minutes ?? 0)); }
  for (const p of previous) if (!seen.has(pathKey(p.path))) out.push(row(p.name, p.path, 0, p.minutes));
  return out;
}

// ---------------------------------------------------------------- insights

export function buildInsights(m: Omit<AnalysisModel, "insights">, input: AnalysisInput, base: TrackerEvent[]): Insight[] {
  const out: Insight[] = [];
  const f = input.fmtDate ?? ((d: DateKey) => d);
  const { stats, prevStats, comparison, sessions, subjects } = m;
  if (!m.hasData) return out;
  const scope = input.scope;
  const total = stats.totalMinutes;
  // Pattern window: from the first tracked event (if that is later than the range start) to the end of the range.
  const effStart = m.trackingStart && m.trackingStart > input.range.start ? m.trackingStart : input.range.start;
  const clamped = effStart > input.range.start;
  const ps: Stats = clamped ? computeStats(base, { start: effStart, end: input.range.end }, input.today) : stats;
  const patternEvents = clamped ? filterByRange(base, effStart, ps.end) : m.events;
  const since = clamped ? ` since ${f(effStart)}` : "";

  // Change vs previous period — only a real percentage; "previous was zero" is not an insight.
  if (comparison.minutes.kind === "pct" && prevStats.totalMinutes > 0 && total > 0) {
    const d = comparison.minutes.diff ?? 0;
    out.push({ id: "change", text: d === 0 ? `Same time as ${input.prev.label.toLowerCase()}.` : `${formatPercentChange(comparison.minutes.pct).replace(/^[+−]/, "")} ${d > 0 ? "more" : "less"} time than ${input.prev.label.toLowerCase()} (${formatSignedDuration(d)}).` });
  }

  // Which subjects moved: needs data in both periods, and a change big enough to matter.
  if (prevStats.totalMinutes > 0 && total > 0) {
    const big = subjectChanges(subjects, m.previousSubjects).filter((c) => Math.abs(c.diff) >= MIN_DATA.moverMinutes && c.kind !== "flat");
    const up = big.filter((c) => c.diff > 0).sort((a, b) => b.diff - a.diff)[0], down = big.filter((c) => c.diff < 0).sort((a, b) => a.diff - b.diff)[0];
    const prevName = input.prev.label.toLowerCase();
    const drillOf = (c: SubjectChange) => ({ title: pathLabel(c.path), start: input.range.start, end: stats.end, path: c.path });
    if (up) out.push({ id: "mover-up", tone: "up", text: up.kind === "new" ? `${up.name} is new compared with ${prevName}: ${formatDuration(up.current)}.` : `${up.name} rose the most: ${formatSignedDuration(up.diff)} (${formatDuration(up.current)} against ${formatDuration(up.previous)}).`, drill: drillOf(up) });
    if (down) out.push({ id: "mover-down", tone: "down", text: down.kind === "gone" ? `${down.name} had ${formatDuration(down.previous)} in ${prevName} and nothing in this period.` : `${down.name} dropped the most: ${formatSignedDuration(down.diff)} (${formatDuration(down.current)} against ${formatDuration(down.previous)}).`, drill: drillOf(down) });
  }

  // Most active subject + concentration — need real composition data.
  if (sessions.count >= MIN_DATA.sessions && subjects.length >= 2 && total >= MIN_DATA.compositionMinutes) {
    const top = subjects[0];
    out.push({ id: "top-subject", text: `Most time: ${top.name} — ${formatDuration(top.minutes)} (${formatPercent(top.share, 0)}).`, drill: { title: pathLabel(top.path), start: input.range.start, end: stats.end, path: top.path } });
    if (subjects.length >= 3) {
      let acc = 0, k = 0;
      for (const s of subjects) { acc += s.minutes; k++; if (acc / total >= 0.8) break; }
      if (k < subjects.length) out.push({ id: "concentration", text: `${k} of ${subjects.length} groups account for ${formatPercent(acc / total, 0)} of your time.` });
    }
  }

  // Sessions
  if (sessions.count >= MIN_DATA.sessions && sessions.averageMinutes !== null && sessions.medianMinutes !== null)
    out.push({ id: "sessions", text: `Average session ${formatDuration(sessions.averageMinutes)}, median ${formatDuration(sessions.medianMinutes)} across ${sessions.count} sessions.` });

  // Session length against the previous period (needs enough sessions in both)
  const ps0 = m.previousSessions;
  if (sessions.count >= MIN_DATA.sessions && ps0.count >= MIN_DATA.sessions && sessions.averageMinutes !== null && ps0.averageMinutes !== null) {
    const d = sessions.averageMinutes - ps0.averageMinutes;
    if (Math.abs(d) >= 5 && Math.abs(d) / ps0.averageMinutes >= 0.1)
      out.push({ id: "session-trend", tone: d > 0 ? "up" : "down", text: `Sessions were ${formatDuration(Math.abs(d))} ${d > 0 ? "longer" : "shorter"} on average than ${input.prev.label.toLowerCase()} (${formatDuration(sessions.averageMinutes)} against ${formatDuration(ps0.averageMinutes)}).` });
  }

  // Planned versus actual — only sessions that had a planned time
  const planned = m.events.filter((e) => e.source !== "activitywatch" && (e.plannedMinutes ?? 0) > 0);
  if (planned.length >= MIN_DATA.plannedSessions) {
    const pl = sum(planned.map((e) => e.plannedMinutes!)), ac = sum(planned.map((e) => e.durationMinutes));
    if (pl > 0) out.push({ id: "planned", text: `${planned.length} sessions had a planned time: you spent ${formatDuration(ac)} of ${formatDuration(pl)} planned (${formatPercent(ac / pl, 0)}).` });
  }

  // Consistency
  if (ps.calendarDays >= MIN_DATA.streakDays && ps.activeDays >= MIN_DATA.consistencyActiveDays && ps.consistency !== null)
    out.push({ id: "consistency", text: `Active on ${ps.activeDays} of ${ps.calendarDays} days${since} (${formatPercent(ps.consistency)}).` });

  // Weekday pattern: average per occurrence of each weekday (so a range with five Mondays isn't biased).
  if (ps.calendarDays >= MIN_DATA.patternDays && ps.activeDays >= MIN_DATA.patternActiveDays) {
    const sumBy = new Array<number>(7).fill(0), countBy = new Array<number>(7).fill(0);
    for (let d = effStart; d <= ps.end; d = addDays(d, 1)) countBy[weekdayOf(d)]++;
    for (const e of patternEvents) sumBy[weekdayOf(e.date)] += e.durationMinutes;
    const avg = sumBy.map((s, i) => (countBy[i] ? s / countBy[i] : null));
    const present = avg.map((a, i) => ({ a: a as number, i })).filter((x) => x.a !== null && countBy[x.i] >= 2);
    if (present.filter((x) => x.a > 0).length >= 3) {
      const hi = Math.max(...present.map((x) => x.a)), lo = Math.min(...present.map((x) => x.a));
      const his = present.filter((x) => x.a === hi), los = present.filter((x) => x.a === lo);
      if (hi > lo && his.length === 1 && los.length === 1)
        out.push({ id: "weekday", text: `Strongest weekday: ${WEEKDAYS[his[0].i]} (avg ${formatDuration(hi)}). Quietest: ${WEEKDAYS[los[0].i]} (avg ${formatDuration(lo)})${since}.` });
    }
  }

  // Strongest / weakest complete week
  if (ps.calendarDays >= MIN_DATA.patternDays) {
    const weeks = bucketSeries(patternEvents, effStart, ps.end, "week", input.weekStartsOn).filter((b) => b.start >= effStart && b.end <= ps.end);
    if (weeks.length >= MIN_DATA.patternWeeks) {
      const hi = weeks.reduce((a, b) => (b.minutes > a.minutes ? b : a)), lo = weeks.reduce((a, b) => (b.minutes < a.minutes ? b : a));
      if (hi.minutes > lo.minutes) out.push({ id: "weeks", text: `Strongest week: ${f(hi.start)} (${formatDuration(hi.minutes)}). Weakest: ${f(lo.start)} (${formatDuration(lo.minutes)}).`, drill: { title: `Week of ${f(hi.start)}`, start: hi.start, end: hi.end, path: scope } });
    }
  }

  // Peak day, streak, gap
  if (stats.peakDay && stats.activeDays >= MIN_DATA.peakActiveDays)
    out.push({ id: "peak-day", text: `Biggest single day: ${f(stats.peakDay.date)} (${formatDuration(stats.peakDay.minutes)}).`, drill: { title: f(stats.peakDay.date), start: stats.peakDay.date, end: stats.peakDay.date, path: scope } });
  if (ps.longestStreak >= 2 && ps.calendarDays >= MIN_DATA.streakDays) out.push({ id: "streak", text: `Longest streak: ${ps.longestStreak} days in a row${since}.` });
  if (ps.longestGap && ps.activeDays >= 2) out.push({ id: "gap", text: `Longest inactive gap: ${ps.longestGap.days} day${ps.longestGap.days === 1 ? "" : "s"} (${f(ps.longestGap.from)}${ps.longestGap.from === ps.longestGap.to ? "" : ` → ${f(ps.longestGap.to)}`}).` });

  return out;
}

import type { Stats } from "./stats";

export type ChangeKind = "pct" | "new" | "none" | "unavailable";
export interface Delta { current: number | null; previous: number | null; diff: number | null; pct: number | null; kind: ChangeKind }

/** ((current − previous) / previous) × 100. Never invents a percentage when previous = 0 or data is missing. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function delta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { current, previous, diff: null, pct: null, kind: "unavailable" };
  const diff = current - previous;
  if (previous === 0) return { current, previous, diff, pct: null, kind: current === 0 ? "none" : "new" };
  return { current, previous, diff, pct: percentChange(current, previous), kind: "pct" };
}

export interface Comparison { minutes: Delta; sessions: Delta; activeDays: Delta; avgPerCalendarDay: Delta; avgPerActiveDay: Delta }
export function compareStats(cur: Stats, prev: Stats): Comparison {
  return {
    minutes: delta(cur.totalMinutes, prev.totalMinutes),
    sessions: delta(cur.sessions, prev.sessions),
    activeDays: delta(cur.activeDays, prev.activeDays),
    avgPerCalendarDay: delta(cur.avgPerCalendarDay, prev.avgPerCalendarDay),
    avgPerActiveDay: delta(cur.avgPerActiveDay, prev.avgPerActiveDay),
  };
}

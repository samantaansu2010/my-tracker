/** Recall / revision analytics and optional spaced-repetition scheduling. Derived from events; stores nothing. */
import type { TrackerEvent } from "./types";
import { addDays, diffDays, elapsedDays, type DateKey } from "./dates";
import { filterByPath, filterByRange, sum } from "./stats";
import { pathKey } from "./hierarchy";

export const isRecall = (e: TrackerEvent, recallKinds: string[]): boolean => !!e.kind && recallKinds.some((k) => k.toLowerCase() === e.kind!.toLowerCase());

export interface RecallStats {
  sessions: number; minutes: number; activeDays: number;
  /** recall sessions per week over the elapsed part of the range */
  frequencyPerWeek: number | null;
  lastRecallDate: DateKey | null; daysSinceLastRecall: number | null;
  byKind: { kind: string; sessions: number; minutes: number }[];
  bySubject: { path: string[]; sessions: number; lastDate: DateKey | null; daysSince: number | null }[];
}

export function recallStats(events: TrackerEvent[], scope: string[], range: { start: DateKey; end: DateKey }, today: DateKey, recallKinds: string[]): RecallStats {
  const all = filterByPath(events, scope).filter((e) => isRecall(e, recallKinds) && e.date <= today);
  const inRange = filterByRange(all, range.start, range.end);
  const days = elapsedDays(range, today);
  const last = all.reduce<DateKey | null>((m, e) => (!m || e.date > m ? e.date : m), null);
  const kinds = new Map<string, { sessions: number; minutes: number }>();
  for (const e of inRange) { const k = kinds.get(e.kind!) ?? { sessions: 0, minutes: 0 }; k.sessions++; k.minutes += e.durationMinutes; kinds.set(e.kind!, k); }
  const subj = new Map<string, { path: string[]; sessions: number; lastDate: DateKey | null }>();
  for (const e of all) {
    const path = e.path.slice(0, 2), key = pathKey(path);
    const s = subj.get(key) ?? { path, sessions: 0, lastDate: null };
    if (e.date >= range.start && e.date <= range.end) s.sessions++;
    if (!s.lastDate || e.date > s.lastDate) s.lastDate = e.date;
    subj.set(key, s);
  }
  return {
    sessions: inRange.length, minutes: sum(inRange.map((e) => e.durationMinutes)), activeDays: new Set(inRange.map((e) => e.date)).size,
    frequencyPerWeek: days ? inRange.length / (days / 7) : null,
    lastRecallDate: last, daysSinceLastRecall: last ? diffDays(last, today) : null,
    byKind: [...kinds].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.sessions - a.sessions),
    bySubject: [...subj.values()].map((s) => ({ ...s, daysSince: s.lastDate ? diffDays(s.lastDate, today) : null })).sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0)),
  };
}

export interface SrsItem { path: string[]; recallDays: number; lastRecall: DateKey | null; nextDue: DateKey; overdueDays: number }
/**
 * Spaced repetition per exact path (topic). Baseline = first time the path was studied. After n distinct recall days
 * the next review is due `intervals[min(n, len−1)]` days after the last recall (or after first exposure if n = 0).
 */
export function spacedRepetition(events: TrackerEvent[], scope: string[], today: DateKey, recallKinds: string[], intervals: number[]): SrsItem[] {
  if (!intervals.length) return [];
  const groups = new Map<string, TrackerEvent[]>();
  for (const e of filterByPath(events, scope)) {
    if (e.date > today) continue;
    const k = pathKey(e.path);
    const g = groups.get(k) ?? [];
    g.push(e);
    groups.set(k, g);
  }
  const out: SrsItem[] = [];
  for (const evs of groups.values()) {
    const first = evs.reduce((m, e) => (e.date < m ? e.date : m), evs[0].date);
    const recallDates = Array.from(new Set(evs.filter((e) => isRecall(e, recallKinds)).map((e) => e.date))).sort();
    const n = recallDates.length;
    const last = n ? recallDates[n - 1] : null;
    const nextDue = addDays(last ?? first, intervals[Math.min(n, intervals.length - 1)]);
    out.push({ path: evs[0].path, recallDays: n, lastRecall: last, nextDue, overdueDays: Math.max(0, diffDays(nextDue, today)) });
  }
  return out.sort((a, b) => a.nextDue.localeCompare(b.nextDue));
}

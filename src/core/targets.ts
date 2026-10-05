import type { Target, TrackerEvent } from "./types";
import { elapsedDays, lengthDays, periodRange, type DateKey, type DateRange } from "./dates";
import { filterByPath, filterByRange, sum } from "./stats";

export interface TargetStatus {
  target: Target; range: DateRange;
  targetMinutes: number; actualMinutes: number; remainingMinutes: number;
  /** actual / target, uncapped (1.25 = 125%). null when the target is 0. */
  completion: number | null;
  /** actual − target: positive = over, negative = under */
  overUnderMinutes: number;
  met: boolean;
  /** linear pace: target × elapsed days ÷ period days */
  expectedByNow: number; onPace: boolean;
}

export function targetStatus(target: Target, events: TrackerEvent[], today: DateKey, weekStartsOn: number, offset = 0): TargetStatus {
  const range = periodRange(target.period, today, weekStartsOn, offset);
  const actual = sum(filterByRange(filterByPath(events, target.path), range.start, range.end < today ? range.end : today).map((e) => e.durationMinutes));
  const len = lengthDays(range), el = Math.min(len, elapsedDays(range, today));
  const expected = target.minutes * (el / len);
  return {
    target, range, targetMinutes: target.minutes, actualMinutes: actual,
    remainingMinutes: Math.max(0, target.minutes - actual),
    completion: target.minutes > 0 ? actual / target.minutes : null,
    overUnderMinutes: actual - target.minutes, met: actual >= target.minutes && target.minutes > 0,
    expectedByNow: expected, onPace: actual >= expected,
  };
}

export interface TargetHistory { periods: TargetStatus[]; completedPeriods: number; metCount: number; hitRate: number | null }
/** The last `count` COMPLETED periods (current period excluded, since it is not finished). Oldest first. */
export function targetHistory(target: Target, events: TrackerEvent[], today: DateKey, weekStartsOn: number, count = 8): TargetHistory {
  const periods: TargetStatus[] = [];
  for (let k = count; k >= 1; k--) periods.push(targetStatus(target, events, today, weekStartsOn, -k));
  const metCount = periods.filter((p) => p.met).length;
  return { periods, completedPeriods: periods.length, metCount, hitRate: periods.length ? metCount / periods.length : null };
}

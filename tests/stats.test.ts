import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats, median, rollup, distribution, topGaps, movingAverage, cumulative, computeTrend, dailySeries, bucketSeries, filterByPath } from "../src/core/stats";
import { percentChange, delta, compareStats } from "../src/core/compare";
import { targetStatus, targetHistory } from "../src/core/targets";
import { evaluateNeglect } from "../src/core/neglect";
import { starterTree } from "../src/core/defaults";
import { ev } from "./helpers";
import { pathKey } from "../src/core/hierarchy";
import { resultStats, performanceIndex, resultTo01 } from "../src/core/performance";
import { recallStats, spacedRepetition } from "../src/core/recall";
import { createDefaultSettings } from "../src/core/defaults";

const M = ["Academic", "Mathematics"], ALG = [...M, "Algebra"], QE = [...ALG, "Quadratic Equations"], POLY = [...ALG, "Polynomials"];
const T = "2026-09-29";

test("hierarchical aggregation: parents are computed, never entered", () => {
  const events = [ev("2026-09-01", 180, QE), ev("2026-09-02", 240, POLY), ev("2026-09-03", 420, ALG), ev("2026-09-04", 60, [...M, "Geometry"]), ev("2026-09-05", 30, ["Technology", "Programming"])];
  const r = rollup(events);
  const get = (p: string[]) => r.get(pathKey(p))!.minutes;
  assert.equal(get(QE), 180);
  assert.equal(get(POLY), 240);
  assert.equal(get(ALG), 840);          // 180 + 240 + 420 direct
  assert.equal(get(M), 900);            // algebra 840 + geometry 60
  assert.equal(get(["Academic"]), 900);
  assert.equal(get(["Technology"]), 30);
  assert.equal(rollup([], starterTree()).get(pathKey(M))!.minutes, 0); // tree nodes appear with zero
  assert.equal(r.get(pathKey(ALG))!.sessions, 3);
});
test("distribution shares sum to 1 and include direct time", () => {
  const events = [ev("2026-09-01", 30, ALG), ev("2026-09-01", 10, M), ev("2026-09-01", 60, [...M, "Geometry"])];
  const d = distribution(events, M);
  assert.deepEqual(d.map((s) => s.name), ["Geometry", "Algebra", "(direct)"]);
  assert.ok(Math.abs(d.reduce((a, s) => a + (s.share ?? 0), 0) - 1) < 1e-12);
  assert.deepEqual(distribution([], []), []);
});
test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
test("spec example: 12 active days of 29 = 41.4% consistency, avg per active day", () => {
  const events = Array.from({ length: 12 }, (_, i) => ev(`2026-09-${String(i * 2 + 1).padStart(2, "0")}`, 93)); // 1,3,...,23
  const s = computeStats(events, { start: "2026-09-01", end: "2026-09-30" }, T);
  assert.equal(s.calendarDays, 29);
  assert.equal(s.activeDays, 12);
  assert.equal(((s.consistency ?? 0) * 100).toFixed(1), "41.4");
  assert.equal(s.avgPerActiveDay, 93);
  assert.equal(s.totalMinutes, 12 * 93);
  assert.ok(Math.abs(s.avgPerCalendarDay! - (12 * 93) / 29) < 1e-9);
});
test("active days vs sessions vs calendar days are distinct", () => {
  const events = [ev("2026-09-10", 30), ev("2026-09-10", 60), ev("2026-09-12", 90)];
  const s = computeStats(events, { start: "2026-09-10", end: "2026-09-13" }, "2026-09-13");
  assert.equal(s.sessions, 3); assert.equal(s.activeDays, 2); assert.equal(s.calendarDays, 4);
  assert.equal(s.avgSession, 60); assert.equal(s.avgPerActiveDay, 90); assert.equal(s.avgPerCalendarDay, 45);
  assert.equal(s.medianSession, 60); assert.equal(s.longestSession!.durationMinutes, 90); assert.equal(s.shortestSession!.durationMinutes, 30);
  assert.deepEqual(s.longestGap, { from: "2026-09-11", to: "2026-09-11", days: 1 });
  assert.equal(s.daysSinceLast, 1);
});
test("empty dataset and zero-activity periods never divide by zero", () => {
  const s = computeStats([], { start: "2026-09-01", end: "2026-09-30" }, T);
  assert.equal(s.totalMinutes, 0); assert.equal(s.sessions, 0); assert.equal(s.consistency, 0);
  assert.equal(s.avgPerActiveDay, null); assert.equal(s.avgSession, null); assert.equal(s.medianSession, null);
  assert.equal(s.longestGap, null); assert.equal(s.daysSinceLast, null); assert.equal(s.peakDay, null);
  assert.equal(s.currentStreak, 0); assert.equal(s.longestStreak, 0);
  const future = computeStats([], { start: "2026-10-01", end: "2026-10-31" }, T);
  assert.equal(future.calendarDays, 0); assert.equal(future.consistency, null); assert.equal(future.avgPerCalendarDay, null);
  for (const v of Object.values(s)) if (typeof v === "number") assert.ok(Number.isFinite(v));
});
test("future-dated events are excluded and reported", () => {
  const s = computeStats([ev("2026-09-29", 10), ev("2026-10-02", 99)], { start: "2026-09-01", end: "2026-10-31" }, T);
  assert.equal(s.totalMinutes, 10); assert.equal(s.excludedFuture, 1);
});
test("longest gap and top gaps", () => {
  assert.deepEqual(topGaps(["2026-09-01", "2026-09-02", "2026-09-10", "2026-09-12"]), [{ from: "2026-09-03", to: "2026-09-09", days: 7 }, { from: "2026-09-11", to: "2026-09-11", days: 1 }]);
  assert.deepEqual(topGaps(["2026-09-01"]), []);
  assert.deepEqual(topGaps(["2026-09-01", "2026-09-01", "2026-09-02"]), []);
  assert.deepEqual(topGaps(["2026-02-27", "2026-03-02"]), [{ from: "2026-02-28", to: "2026-03-01", days: 2 }]);
  assert.deepEqual(topGaps(["2024-02-27", "2024-03-01"]), [{ from: "2024-02-28", to: "2024-02-29", days: 2 }]);
});
test("streaks: empty today does not break an ongoing streak", () => {
  const ev3 = [ev("2026-09-26", 10), ev("2026-09-27", 10), ev("2026-09-28", 10)];
  const s = computeStats(ev3, { start: "2026-09-20", end: T }, T);
  assert.equal(s.currentStreak, 3);
  const s2 = computeStats([...ev3, ev(T, 5)], { start: "2026-09-20", end: T }, T);
  assert.equal(s2.currentStreak, 4); assert.equal(s2.longestStreak, 4);
  const s3 = computeStats([ev("2026-09-20", 5), ev("2026-09-21", 5), ev("2026-09-25", 5)], { start: "2026-09-20", end: T }, T);
  assert.equal(s3.currentStreak, 0); assert.equal(s3.longestStreak, 2);
});
test("peaks", () => {
  const s = computeStats([ev("2026-09-28", 30, M, { timestamp: "2026-09-28T07:00:00+00:00" }), ev("2026-09-29", 90, M, { timestamp: "2026-09-29T20:00:00+00:00" })], { start: "2026-09-28", end: T }, T);
  assert.deepEqual(s.peakDay, { date: "2026-09-29", minutes: 90 });
  assert.equal(s.peakWeekday!.weekday, 2); // Tuesday
  assert.equal(s.peakPeriod!.label, "Evening (18–24)");
});
test("planned vs actual only counts events that have a plan", () => {
  const s = computeStats([ev("2026-09-28", 50, M, { plannedMinutes: 60 }), ev("2026-09-29", 30, M)], { start: "2026-09-28", end: T }, T);
  assert.deepEqual(s.planned, { plannedMinutes: 60, actualMinutes: 50, sessions: 1, ratio: 50 / 60 });
});
test("series helpers", () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(cumulative([1, 2, 3]), [1, 3, 6]);
  const d = dailySeries([ev("2026-09-02", 5)], "2026-09-01", "2026-09-03");
  assert.deepEqual(d.map((p) => p.minutes), [0, 5, 0]);
  const w = bucketSeries([ev("2026-09-27", 10), ev("2026-09-28", 20)], "2026-09-21", "2026-10-04", "week", 1);
  assert.deepEqual(w.map((b) => [b.start, b.minutes]), [["2026-09-21", 10], ["2026-09-28", 20]]);
  const mo = bucketSeries([ev("2026-01-31", 5), ev("2026-02-01", 7)], "2026-01-01", "2026-03-15", "month", 1);
  assert.deepEqual(mo.map((b) => [b.key, b.minutes]), [["2026-01", 5], ["2026-02", 7], ["2026-03", 0]]);
});
test("trend needs 7 days and detects direction", () => {
  assert.equal(computeTrend([1, 2, 3]).status, "insufficient");
  assert.equal(computeTrend([10, 20, 30, 40, 50, 60, 70]).direction, "up");
  assert.equal(computeTrend([70, 60, 50, 40, 30, 20, 10]).direction, "down");
  assert.equal(computeTrend([30, 30, 30, 30, 30, 30, 30]).direction, "flat");
  assert.equal(computeTrend([0, 0, 0, 0, 0, 0, 0]).relativeChange, null);
});

test("percent change and zero denominators", () => {
  assert.equal(percentChange(1120, 860)?.toFixed(1), "30.2"); // spec: 18h40m vs 14h20m
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(0, 0), null);
  assert.equal(percentChange(null, 5), null);
  assert.equal(percentChange(0, 10), -100);
  assert.deepEqual([delta(5, 0).kind, delta(0, 0).kind, delta(null, 3).kind, delta(6, 3).kind], ["new", "none", "unavailable", "pct"]);
  assert.equal(delta(1120, 860).diff, 260);
});
test("period comparison", () => {
  const cur = computeStats([ev("2026-09-28", 100), ev("2026-09-29", 20)], { start: "2026-09-22", end: "2026-09-29" }, T);
  const prev = computeStats([ev("2026-09-20", 60)], { start: "2026-09-14", end: "2026-09-21" }, T);
  const c = compareStats(cur, prev);
  assert.equal(c.minutes.diff, 60); assert.equal(c.sessions.diff, 1); assert.equal(c.activeDays.diff, 1);
  assert.equal(c.minutes.pct, 100);
});

test("targets: actual, remaining, completion, over/under, history", () => {
  const events = [ev("2026-09-28", 120, M), ev("2026-09-29", 60, M), ev("2026-09-22", 600, M), ev("2026-09-15", 300, M)];
  const t = { id: "t", path: M, minutes: 600, period: "week" as const };
  const s = targetStatus(t, events, T, 1);
  assert.equal(s.actualMinutes, 180); assert.equal(s.remainingMinutes, 420); assert.equal(s.completion, 0.3); assert.equal(s.overUnderMinutes, -420); assert.equal(s.met, false);
  assert.equal(s.expectedByNow, 600 * 2 / 7);
  const h = targetHistory(t, events, T, 1, 3);
  assert.deepEqual(h.periods.map((p) => p.actualMinutes), [0, 300, 600]); // weeks of 09-07, 09-14, 09-21
  assert.equal(h.metCount, 1); assert.equal(h.hitRate, 1 / 3);
  const over = targetStatus({ ...t, minutes: 100 }, events, T, 1);
  assert.equal(over.overUnderMinutes, 80); assert.ok(over.met); assert.equal(over.completion, 1.8);
  assert.equal(targetStatus({ ...t, minutes: 0 }, events, T, 1).completion, null);
  const day = targetStatus({ id: "d", path: M, minutes: 30, period: "day" }, events, T, 1);
  assert.equal(day.actualMinutes, 60); assert.ok(day.met);
  const month = targetStatus({ id: "m", path: M, minutes: 1000, period: "month" }, events, T, 1);
  assert.equal(month.actualMinutes, 1080);
});

test("neglected areas distinguish intentional / temporary / never", () => {
  const tree = starterTree();
  const acad = tree[0].children;
  acad[1].inactive = "intentional"; // English
  acad[2].inactive = "temporary"; acad[2].pausedUntil = "2026-10-15"; // Physical Science
  const events = [ev("2026-09-20", 30, M), ev("2026-09-28", 30, ["Technology", "Programming"])];
  const items = evaluateNeglect(tree, events, T, 7);
  const st = (name: string) => items.find((i) => i.path[1] === name)!;
  assert.equal(st("Mathematics").status, "neglected"); assert.equal(st("Mathematics").daysSince, 9);
  assert.equal(st("Programming").status, "ok");
  assert.equal(st("English").status, "intentional");
  assert.equal(st("Physical Science").status, "temporary");
  assert.equal(st("Computer").status, "never");
  acad[2].pausedUntil = "2026-09-01"; // pause expired, never used -> never (not neglected)
  assert.equal(evaluateNeglect(tree, events, T, 7).find((i) => i.path[1] === "Physical Science")!.status, "never");
  acad[0].neglectDays = 30;
  assert.equal(evaluateNeglect(tree, events, T, 7).find((i) => i.path[1] === "Mathematics")!.status, "ok");
  assert.equal(items[0].status, "neglected");
});

test("results and transparent performance index", () => {
  const s = createDefaultSettings(T);
  const events = [ev("2026-09-28", 30, M, { result: "A", scores: { recall: 8 } }), ev("2026-09-29", 30, M, { result: "C", scores: { recall: 6 } }), ev("2026-09-29", 30, M)];
  assert.equal(resultTo01("A", s.resultScale), 1); assert.equal(resultTo01("D", s.resultScale), 0); assert.equal(resultTo01("Z", s.resultScale), null);
  const rs = resultStats(events, s.resultScale);
  assert.equal(rs.rated, 2); assert.ok(Math.abs(rs.mean01! - (1 + 1 / 3) / 2) < 1e-12);
  const idx = performanceIndex(events, s.resultScale, s.measurements, { includeResult: true, resultWeight: 1, measurementWeights: { recall: 1 } });
  assert.ok(Math.abs(idx.index! - 100 * ((1 + 1 / 3) / 2 + 0.7) / 2) < 1e-9);
  assert.equal(performanceIndex([], s.resultScale, s.measurements, { includeResult: true, resultWeight: 1, measurementWeights: {} }).index, null);
});

test("recall stats and spaced repetition", () => {
  const events = [ev("2026-09-20", 30, ALG), ev("2026-09-25", 15, ALG, { kind: "Recall" }), ev("2026-09-27", 15, ALG, { kind: "revision" }), ev("2026-09-10", 30, ["Academic", "English"])];
  const r = recallStats(events, [], { start: "2026-09-01", end: T }, T, ["Recall", "Revision", "Test"]);
  assert.equal(r.sessions, 2); assert.equal(r.daysSinceLastRecall, 2); assert.equal(r.byKind.length, 2);
  assert.ok(Math.abs(r.frequencyPerWeek! - 2 / (29 / 7)) < 1e-9);
  const srs = spacedRepetition(events, [], T, ["Recall", "Revision"], [1, 3, 7, 14]);
  const alg = srs.find((i) => i.path.join() === ALG.join())!;
  assert.equal(alg.recallDays, 2); assert.equal(alg.nextDue, "2026-10-04"); assert.equal(alg.overdueDays, 0); // 27 Sep + 7
  const eng = srs.find((i) => i.path[1] === "English")!;
  assert.equal(eng.recallDays, 0); assert.equal(eng.nextDue, "2026-09-11"); assert.equal(eng.overdueDays, 18);
});
test("filterByPath is prefix-exact", () => {
  assert.equal(filterByPath([ev("2026-09-01", 1, ["Academic", "Math"]), ev("2026-09-01", 1, ["Academic", "Mathematics"])], ["Academic", "Math"]).length, 1);
});

test("trend is withheld when there are too few active days to mean anything", () => {
  const one = computeStats([ev("2026-09-29", 135)], { start: "2026-09-23", end: T }, T);
  assert.equal(one.trend.status, "insufficient");
  const many = computeStats([ev("2026-09-25", 30), ev("2026-09-27", 60), ev("2026-09-29", 90)], { start: "2026-09-23", end: T }, T);
  assert.equal(many.trend.status, "ok"); assert.equal(many.trend.direction, "up");
});

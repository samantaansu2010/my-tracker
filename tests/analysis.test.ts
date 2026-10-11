import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_DATA, analyseSessions, autoGranularity, buildAnalysis, buildHeatmap, compositionSlices, countAxis, heatmapCaption, subjectChanges, eventFilter, groupAtDepth, intensityLevel, intensityThresholds, scopeOptions, sessionHistogram, HEATMAP_MAX_WEEKS, HEATMAP_MIN_WEEKS, type AnalysisInput } from "../src/core/analysis";
import { previousRange, resolveRange, addDays } from "../src/core/dates";
import { starterTree } from "../src/core/defaults";
import { ev } from "./helpers";
import type { TrackerEvent } from "../src/core/types";

const T = "2026-10-07"; // a Wednesday
const MATH = ["Academic", "Mathematics"], ENG = ["Academic", "English"], PROG = ["Technology", "Programming"], COMP = ["Technology", "Computer", "Code"];
const input = (events: TrackerEvent[], rangeId: any = "thisMonth", o: Partial<AnalysisInput> = {}): AnalysisInput => {
  const opts = { weekStartsOn: 1 };
  const range = resolveRange({ id: rangeId }, T, opts);
  return { events, scope: [], range, prev: previousRange(range, T, true), today: T, weekStartsOn: 1, includeActivityWatch: true, ...o };
};
const days = (from: string, n: number, minutes: number, path = MATH, extra: Partial<TrackerEvent> = {}) => Array.from({ length: n }, (_, i) => ev(addDays(from, i), minutes, path, extra));

test("granularity follows range length", () => {
  assert.deepEqual([1, 31, 62, 63, 365, 400, 401, 4000].map(autoGranularity), ["day", "day", "day", "week", "week", "week", "month", "month"]);
});

test("heat intensity: quartiles, few days, uniform days, zero", () => {
  assert.deepEqual(intensityThresholds([]), []);
  assert.deepEqual(intensityThresholds([0, 0]), []);
  assert.deepEqual(intensityThresholds([40]), [10, 20, 30]);                       // < 4 active days: linear on max
  assert.deepEqual(intensityThresholds([60, 60, 60, 60, 60]), [15, 30, 45]);        // all alike: linear (so they read as the top level)
  assert.deepEqual(intensityThresholds([10, 20, 30, 40, 50, 60, 70, 80]), [20, 40, 60]); // quartiles
  const t = [20, 40, 60];
  assert.deepEqual([0, -5, 10, 20, 21, 40, 41, 60, 61, 500].map((m) => intensityLevel(m, t)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(intensityLevel(30, []), 1);
});

test("heatmap: window is at least 26 and at most 53 weeks, ends at today, never shows the future", () => {
  const e = [ev("2026-10-05", 90, MATH), ev("2026-10-07", 30, MATH)];
  const h = buildHeatmap(e, { start: T, end: T }, T, 1);          // 'Today'
  assert.equal(h.weeks, HEATMAP_MIN_WEEKS); assert.equal(h.columns.length, HEATMAP_MIN_WEEKS);
  const lastCol = h.columns[h.columns.length - 1];
  assert.equal(lastCol[lastCol.length - 1].date, T);                // Mon..Wed only
  assert.equal(lastCol.length, 3);
  assert.equal(h.columns[0][0].date, addDays("2026-10-05", -(HEATMAP_MIN_WEEKS - 1) * 7));
  assert.deepEqual(h.rowWeekdays, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(lastCol.find((c) => c.date === T)!.inRange, true); assert.equal(lastCol.find((c) => c.date === "2026-10-05")!.inRange, false);
  const long = buildHeatmap(e, resolveRange({ id: "custom", custom: { start: "2015-01-01", end: T } }, T, { weekStartsOn: 1 }), T, 1);
  assert.equal(long.weeks, HEATMAP_MAX_WEEKS); assert.equal(long.capped, true);
  const mid = buildHeatmap(e, resolveRange({ id: "thisYear" }, T, { weekStartsOn: 1 }), T, 1);
  assert.equal(mid.weeks, 41); assert.equal(mid.capped, false); // 1 Jan 2026 week → this week
});
test("heatmap summary counts inactive days and consistency; Sunday-start layout; month labels", () => {
  const e = [...days("2026-09-14", 3, 60), ev("2026-10-06", 45, MATH)];
  const h = buildHeatmap(e, { start: "2026-09-14", end: T }, T, 0);
  assert.deepEqual(h.rowWeekdays, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(h.summary.activeDays, 4);
  assert.equal(h.summary.elapsedDays, h.columns.flat().length);
  assert.ok(Math.abs(h.summary.consistency! - 4 / h.summary.elapsedDays) < 1e-12);
  assert.equal(h.summary.maxMinutes, 60);
  assert.equal(h.monthStarts[0].col, 0); assert.ok(h.monthStarts.every((m, i, a) => i === 0 || m.key > a[i - 1].key));
  const empty = buildHeatmap([], { start: T, end: T }, T, 1);
  assert.equal(empty.summary.activeDays, 0); assert.equal(empty.summary.maxMinutes, 0); assert.ok(empty.columns.flat().every((c) => c.level === 0));
  const future = buildHeatmap([], { start: "2027-01-01", end: "2027-12-31" }, T, 1);
  assert.equal(future.end, T); assert.ok(future.columns.flat().every((c) => !c.inRange));
});

test("heatmap range summary counts only days inside the selected range (matches the KPIs)", () => {
  const e = [...days("2026-09-10", 3, 30), ev("2026-10-06", 45, MATH)];
  const h = buildHeatmap(e, { start: "2026-09-30", end: T }, T, 1);
  assert.equal(h.rangeSummary.elapsedDays, 8); assert.equal(h.rangeSummary.activeDays, 1);       // 30 Sep … 7 Oct, only the 6th is active
  assert.ok(Math.abs(h.rangeSummary.consistency! - 1 / 8) < 1e-12);
  assert.ok(h.summary.elapsedDays > h.rangeSummary.elapsedDays && h.summary.activeDays === 4);   // the window also contains the 3 earlier days
  const m = buildAnalysis(input(e, "custom", { range: resolveRange({ id: "custom", custom: { start: "2026-09-30", end: T } }, T, { weekStartsOn: 1 }) }));
  assert.equal(m.heatmap.rangeSummary.activeDays, m.stats.activeDays); assert.equal(m.heatmap.rangeSummary.elapsedDays, m.stats.calendarDays);
});

test("session histogram bins are half-open and total to the number of sessions", () => {
  const h = sessionHistogram([5, 14.99, 15, 29, 30, 59, 60, 89, 90, 119, 120, 179, 180, 1000]);
  assert.deepEqual(h.map((b) => b.count), [2, 2, 2, 2, 2, 2, 2]);
  assert.equal(h.reduce((a, b) => a + b.count, 0), 14);
  assert.deepEqual(sessionHistogram([]).map((b) => b.count), [0, 0, 0, 0, 0, 0, 0]);
});
test("session analysis excludes ActivityWatch daily totals and never invents values", () => {
  const e = [ev("2026-10-01", 30, MATH), ev("2026-10-02", 60, MATH), ev("2026-10-03", 90, MATH), ev("2026-10-03", 600, COMP, { source: "activitywatch" })];
  const s = analyseSessions(e);
  assert.equal(s.count, 3); assert.equal(s.excludedDailyTotals, 1); assert.equal(s.averageMinutes, 60); assert.equal(s.medianMinutes, 60);
  assert.equal(s.longest!.durationMinutes, 90); assert.equal(s.shortest!.durationMinutes, 30); assert.equal(s.totalMinutes, 180);
  const none = analyseSessions([]);
  assert.deepEqual([none.count, none.averageMinutes, none.medianMinutes, none.longest, none.shortest], [0, null, null, null, null]);
  assert.equal(analyseSessions([ev("2026-10-01", 20, MATH)]).medianMinutes, 20);
});

test("composition: donut only when it stays readable", () => {
  const g = (n: number, mins: number) => ({ name: `G${n}`, path: [`G${n}`], minutes: mins, sessions: 1, share: null });
  assert.equal(compositionSlices([]).donut, false);
  assert.equal(compositionSlices([g(1, 10)]).donut, false);
  assert.equal(compositionSlices([g(1, 10), g(2, 10)]).donut, true);
  const many = compositionSlices([g(1, 100), g(2, 90), g(3, 80), g(4, 70), g(5, 60), g(6, 5), g(7, 5)]);   // 7 groups → 5 + Other(10)
  assert.equal(many.slices.length, 6); assert.equal(many.slices[5].name, "Other"); assert.equal(many.slices[5].minutes, 10); assert.equal(many.donut, true);
  const fragmented = compositionSlices(Array.from({ length: 12 }, (_, i) => g(i, 10)));                    // Other = 70% → bars are better
  assert.equal(fragmented.donut, false); assert.ok(fragmented.reason);
  assert.equal(compositionSlices([g(1, 10), { ...g(2, 0) }]).slices.length, 1);                            // zero-minute groups dropped
});
test("grouping respects the hierarchy and keeps same-named subjects in different categories apart", () => {
  const e = [ev("2026-10-01", 30, ["Academic", "Research"]), ev("2026-10-01", 20, ["Personal", "Research"]), ev("2026-10-01", 10, ["Academic"])];
  const bySubject = groupAtDepth(e, 1);
  assert.equal(bySubject.length, 3); assert.deepEqual(bySubject.map((s) => s.name), ["Research", "Research", "(direct)"]);
  assert.deepEqual(bySubject.map((s) => s.path.join("/")), ["Academic/Research", "Personal/Research", "Academic"]);
  assert.deepEqual(groupAtDepth(e, 0).map((s) => [s.name, s.minutes]), [["Academic", 40], ["Personal", 20]]);
  assert.deepEqual(groupAtDepth([], 0), []);
});
test("scope options: tree + subjects that only exist in events; filter honours scope and the ActivityWatch switch", () => {
  const e = [ev("2026-10-01", 30, ["Legacy", "Old subject"]), ev("2026-10-01", 30, MATH, { source: "activitywatch" })];
  const o = scopeOptions(starterTree(), e);
  assert.equal(o[0].label, "All activity"); assert.ok(o.some((x) => x.label === "Mathematics")); assert.ok(o.some((x) => x.label.includes("Legacy › Old subject") && x.label.includes("not in subject list")));
  assert.equal(new Set(o.map((x) => x.key)).size, o.length);
  assert.equal(eventFilter({ scope: ["Academic"], includeActivityWatch: true })(e[1]), true);
  assert.equal(eventFilter({ scope: ["Academic"], includeActivityWatch: false })(e[1]), false);
  assert.equal(eventFilter({ scope: ["Technology"], includeActivityWatch: true })(e[1]), false);
});

test("empty dataset: no data, no insights, no NaN, every chart structure is safe", () => {
  const m = buildAnalysis(input([]));
  assert.equal(m.hasData, false); assert.deepEqual(m.insights, []); assert.equal(m.stats.totalMinutes, 0);
  assert.equal(m.sessions.count, 0); assert.deepEqual(m.subjects, []); assert.equal(m.composition.donut, false);
  assert.ok(m.activity.buckets.every((b) => b.minutes === 0)); assert.ok(m.heatmap.columns.length >= HEATMAP_MIN_WEEKS);
  assert.equal(m.comparison.minutes.kind, "none");
});
test("a single event produces no insights (not enough data) but valid totals", () => {
  const m = buildAnalysis(input([ev("2026-10-05", 45, MATH)]));
  assert.equal(m.hasData, true); assert.equal(m.stats.totalMinutes, 45); assert.equal(m.sessions.count, 1); assert.equal(m.sessions.medianMinutes, 45);
  assert.deepEqual(m.insights, []);
});
test("few days of data: only insights that the minimum-data rules allow", () => {
  const e = [ev("2026-10-05", 60, MATH), ev("2026-10-06", 30, ENG), ev("2026-10-07", 45, MATH)];
  const ids = buildAnalysis(input(e, "thisWeek")).insights.map((i) => i.id);
  assert.ok(ids.includes("top-subject") && ids.includes("sessions"));
  for (const bad of ["weekday", "weeks", "consistency", "streak", "change", "concentration"]) assert.ok(!ids.includes(bad), bad);
});
test("zero previous-period activity never yields a percentage or a 'change' insight", () => {
  const m = buildAnalysis(input(days("2026-10-01", 6, 30)));
  assert.equal(m.comparison.minutes.kind, "new"); assert.equal(m.comparison.minutes.pct, null);
  assert.ok(!m.insights.some((i) => i.id === "change"));
  assert.deepEqual(m.periods.previous.every((v) => v === 0), true);
});
test("with real history the insights appear and the numbers are the engine's numbers", () => {
  // Sep 1 → Oct 7. Mon/Tue/Wed maths 60m, Tue also programming 25m, Thu english 30m, Fri 10m, Sat 5m, Sun nothing.
  const e: TrackerEvent[] = [];
  for (let d = "2026-09-01"; d <= T; d = addDays(d, 1)) {
    const wd = new Date(d + "T00:00:00Z").getUTCDay();
    if (wd >= 1 && wd <= 3) e.push(ev(d, 60, MATH));
    if (wd === 2) e.push(ev(d, 25, PROG));
    if (wd === 4) e.push(ev(d, 30, ENG));
    if (wd === 5) e.push(ev(d, 10, ENG));
    if (wd === 6) e.push(ev(d, 5, ENG));
  }
  e.push(...days("2026-08-05", 4, 30));
  const m = buildAnalysis(input(e, "last90", { fmtDate: (d) => d }));
  const byId = Object.fromEntries(m.insights.map((i) => [i.id, i.text]));
  assert.match(byId["top-subject"], /^Most time: Mathematics — /);
  assert.match(byId["weekday"], /^Strongest weekday: Tuesday \(avg [^)]+\)\. Quietest: Sunday \(avg 0m\) since 2026-08-05\./);
  for (const id of ["weeks", "peak-day", "streak", "gap", "consistency", "sessions", "concentration"]) assert.ok(byId[id], `missing ${id}`);
  assert.equal(m.stats.totalMinutes, m.events.reduce((a, x) => a + x.durationMinutes, 0));
  assert.equal(m.insights.find((i) => i.id === "top-subject")!.drill!.path.join("/"), "Academic/Mathematics");
  for (const i of m.insights) assert.ok(i.text.length > 10 && !/NaN|undefined|Infinity/.test(i.text), i.text);
});
test("pattern insights ignore days before tracking began (no phantom 'weakest week')", () => {
  const e = days("2026-09-14", 24, 40);                                   // tracked 14 Sep → 7 Oct, every day
  const m = buildAnalysis(input(e, "last90", { fmtDate: (d) => d }));      // range reaches back to July
  assert.equal(m.trackingStart, "2026-09-14");
  const consistency = m.insights.find((i) => i.id === "consistency")!.text;
  assert.match(consistency, /Active on 24 of 24 days since 2026-09-14 \(100\.0%\)/);
  assert.ok(!m.insights.some((i) => i.id === "gap"));                      // no gaps once tracking began
  assert.ok(!m.insights.some((i) => i.id === "weeks"));                     // every complete week is identical → nothing to compare
  assert.match(m.insights.find((i) => i.id === "streak")!.text, /24 days in a row since 2026-09-14/);
  // and the KPI numbers still describe the full selected range, like the dashboard does
  assert.equal(m.stats.calendarDays, 90); assert.equal(m.stats.activeDays, 24);
});
test("change insight: more / less / same, with the engine's percentage", () => {
  const more = buildAnalysis(input([...days("2026-09-01", 3, 20), ...days("2026-10-01", 6, 40)], "thisMonth", { prev: previousRange(resolveRange({ id: "thisMonth" }, T, { weekStartsOn: 1 }), T, false) }));
  assert.match(more.insights.find((i) => i.id === "change")!.text, /^\d+(\.\d)?% more time than previous month/);
  const less = buildAnalysis(input([...days("2026-09-01", 10, 60), ...days("2026-10-01", 2, 30)], "thisMonth", { prev: previousRange(resolveRange({ id: "thisMonth" }, T, { weekStartsOn: 1 }), T, false) }));
  assert.match(less.insights.find((i) => i.id === "change")!.text, /less time than previous month/);
});
test("minimum-data thresholds are enforced exactly", () => {
  const two = buildAnalysis(input([ev("2026-10-05", 60, MATH), ev("2026-10-06", 60, ENG)], "thisWeek"));
  assert.ok(!two.insights.some((i) => i.id === "sessions" || i.id === "top-subject"));            // 2 sessions < MIN_DATA.sessions
  assert.equal(MIN_DATA.sessions, 3);
  const small = buildAnalysis(input([ev("2026-10-05", 5, MATH), ev("2026-10-06", 5, ENG), ev("2026-10-07", 5, MATH)], "thisWeek"));
  assert.ok(!small.insights.some((i) => i.id === "top-subject"));                                  // 15 min < 60 min composition minimum
});
test("zero-activity subject filter yields an empty but valid model", () => {
  const m = buildAnalysis(input(days("2026-10-01", 5, 30, MATH), "thisMonth", { scope: ["Technology"] }));
  assert.equal(m.hasData, false); assert.equal(m.stats.totalMinutes, 0); assert.deepEqual(m.insights, []);
});
test("ActivityWatch mixed with manual: counted as time, excluded from sessions, switchable", () => {
  const e = [...days("2026-10-01", 3, 30, MATH), ev("2026-10-02", 400, COMP, { source: "activitywatch" })];
  const on = buildAnalysis(input(e)), off = buildAnalysis(input(e, "thisMonth", { includeActivityWatch: false }));
  assert.equal(on.stats.totalMinutes, 490); assert.equal(on.sessions.count, 3); assert.equal(on.sessions.excludedDailyTotals, 1); assert.equal(on.stats.sessions, 4);
  assert.equal(off.stats.totalMinutes, 90); assert.equal(off.sessions.excludedDailyTotals, 0);
  assert.ok(on.subjects.some((s) => s.path[0] === "Technology")); assert.ok(!off.subjects.some((s) => s.path[0] === "Technology"));
});
test("today range, custom range and previous-period series are consistent", () => {
  const e = [...days("2026-10-01", 7, 30), ev("2026-09-30", 100, MATH)];
  const today = buildAnalysis(input(e, "today"));
  assert.equal(today.stats.totalMinutes, 30); assert.equal(today.granularity, "day"); assert.equal(today.activity.buckets.length, 1);
  const custom = buildAnalysis(input(e, "custom", { range: resolveRange({ id: "custom", custom: { start: "2026-10-02", end: "2026-10-04" } }, T, { weekStartsOn: 1 }), prev: previousRange(resolveRange({ id: "custom", custom: { start: "2026-10-02", end: "2026-10-04" } }, T, { weekStartsOn: 1 }), T) }));
  assert.equal(custom.stats.totalMinutes, 90); assert.equal(custom.prevStats.totalMinutes, 130); // previous = 09-29..10-01: the 100m on 09-30 + 30m on 10-01
  assert.deepEqual(custom.periods.current, [30, 60, 90]); assert.deepEqual(custom.periods.previous, [0, 100, 130]);
});
test("week/month granularity marks partial buckets", () => {
  const e = days("2026-09-01", 36, 20);
  const m = buildAnalysis(input(e, "last90", { granularity: "month" }));
  assert.equal(m.activity.buckets.every((b) => b.minutes >= 0), true);
  assert.ok(m.activity.partial.some(Boolean));
  assert.equal(m.activity.movingAverage.length, m.activity.buckets.length);
  const w = buildAnalysis(input(e, "thisMonth", { granularity: "week" }));
  assert.equal(w.activity.window, 4); assert.equal(w.activity.partial[0], true);
});
test("very long range stays fast and bounded", () => {
  const e: TrackerEvent[] = [];
  for (let i = 0; i < 12000; i++) e.push(ev(addDays("2016-01-01", i % 3900), 20 + (i % 70), i % 2 ? MATH : PROG));
  const range = resolveRange({ id: "custom", custom: { start: "2016-01-01", end: T } }, T, { weekStartsOn: 1 });
  const t0 = performance.now();
  const m = buildAnalysis({ events: e, scope: [], range, prev: previousRange(range, T, true), today: T, weekStartsOn: 1, includeActivityWatch: true });
  const ms = performance.now() - t0;
  assert.equal(m.granularity, "month"); assert.equal(m.heatmap.weeks, HEATMAP_MAX_WEEKS); assert.ok(m.activity.buckets.length < 200);
  assert.ok(ms < 1500, `took ${ms}ms`);
});
test("the model never mutates its inputs", () => {
  const e = days("2026-10-01", 6, 30); const snapshot = JSON.stringify(e);
  buildAnalysis(input(e)); assert.equal(JSON.stringify(e), snapshot);
});

test("count axis: whole-number ticks only, never duplicated labels", () => {
  assert.deepEqual(countAxis(1), { max: 1, ticks: [0, 1] });              // was rendered as "1, 1, 0"
  assert.deepEqual(countAxis(2), { max: 2, ticks: [0, 1, 2] });
  assert.deepEqual(countAxis(4), { max: 4, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(countAxis(0), { max: 1, ticks: [0, 1] });
  assert.deepEqual(countAxis(NaN), { max: 1, ticks: [0, 1] });
  assert.deepEqual(countAxis(7), { max: 8, ticks: [0, 2, 4, 6, 8] });
  assert.deepEqual(countAxis(23), { max: 25, ticks: [0, 5, 10, 15, 20, 25] });
  for (const n of [1, 3, 5, 9, 12, 40, 99, 101, 1000]) {
    const a = countAxis(n);
    assert.ok(a.max >= n, `max covers ${n}`);
    assert.ok(a.ticks.every(Number.isInteger), `integer ticks for ${n}`);
    assert.equal(new Set(a.ticks).size, a.ticks.length, `no duplicate ticks for ${n}`);
    assert.ok(a.ticks.length <= 6, `at most 6 ticks for ${n}`);
    assert.equal(a.ticks[a.ticks.length - 1], a.max);
  }
});

test("heatmap caption says what the numbers cover", () => {
  const short = buildHeatmap([ev("2026-10-06", 60)], { start: "2026-10-04", end: "2026-10-07" }, T, 1);
  const cs = heatmapCaption(short);
  assert.match(cs, /of \d+ days active/);
  assert.match(cs, /last \d+ weeks shown for context/);     // a 4-day range must not silently quote a 6-month window
  const long = buildHeatmap([ev("2026-10-06", 60)], { start: "2026-09-01", end: "2026-10-07" }, T, 1);
  assert.equal(heatmapCaption(long), `1 of ${long.rangeSummary.elapsedDays} days active`);
});

test("subject changes: a subject with nothing before is \"new\" and gets no invented percentage; one that vanished is -100%", () => {
  const sl = (name: string, minutes: number) => ({ name, path: ["Academic", name], minutes, sessions: 1, share: null });
  const rows = subjectChanges([sl("Math", 60), sl("Philosophy", 30), sl("Same", 20)], [sl("Math", 30), sl("English", 20), sl("Same", 20)]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(rows.length, 4);
  assert.deepEqual([by.Math.kind, by.Math.diff, by.Math.pct], ["pct", 30, 100]);
  assert.deepEqual([by.Philosophy.kind, by.Philosophy.pct, by.Philosophy.previous], ["new", null, 0]);
  assert.deepEqual([by.English.kind, by.English.pct, by.English.current], ["gone", -100, 0]);
  assert.equal(by.Same.kind, "flat");
});

test("insights: subject movers, session-length trend and planned time come from real changes only", () => {
  const events = [
    ...days("2026-09-01", 3, 45, MATH), ev("2026-09-02", 60, PROG),              // previous period: Math 135m, Programming 60m (4 sessions)
    ...days("2026-10-01", 3, 90, MATH, { plannedMinutes: 60 }), ...days("2026-10-01", 3, 40, ENG),   // current: Math 270m, English 120m (6 sessions)
  ];
  const m = buildAnalysis(input(events, "thisMonth"));
  const ids = m.insights.map((i) => i.id);
  assert.ok(ids.includes("mover-up") && ids.includes("mover-down") && ids.includes("session-trend") && ids.includes("planned"), ids.join());
  const up = m.insights.find((i) => i.id === "mover-up")!, down = m.insights.find((i) => i.id === "mover-down")!;
  assert.match(up.text, /^Mathematics rose the most: \+2h 15m/);        // 270m against 135m
  assert.equal(up.tone, "up");
  assert.match(down.text, /^Programming had 1h/);                        // had time before, nothing now: no made-up percentage
  assert.equal(down.tone, "down");
  assert.match(m.insights.find((i) => i.id === "planned")!.text, /^3 sessions had a planned time: you spent 4h 30m of 3h planned \(150%\)/);
  // without a previous period there is nothing to compare: no mover or trend insights
  const first = buildAnalysis(input(days("2026-10-01", 5, 45, MATH), "thisMonth"));
  assert.ok(!first.insights.some((i) => i.id.startsWith("mover") || i.id === "session-trend"));
  assert.deepEqual(first.previousSubjects, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDuration, formatDuration, formatSignedDuration } from "../src/core/duration";
import { formatShortDate, formatMonthLabel, resolveRange, previousRange, addDays, diffDays, isLeapYear, daysInMonth, startOfWeek, shiftMonthStart, elapsedDays, toDateKey, formatLocalIso, rangeInstants, isDateKey } from "../src/core/dates";

const opts = { weekStartsOn: 1, installDate: "2026-03-10" };
const R = (id: any, today = "2026-09-29", n?: number) => resolveRange({ id, n }, today, opts);

test("duration parser accepts every documented format", () => {
  const cases: [string, number][] = [["20m", 20], ["20 min", 20], ["20 minutes", 20], ["1h", 60], ["1 hour", 60], ["1h 30m", 90], ["1h30m", 90], ["90m", 90], ["01:30", 90], ["1:30", 90], ["1.5h", 90], ["1 hour 20 minutes", 80], ["2 hrs", 120], ["1,5h", 90]];
  for (const [s, m] of cases) assert.equal(parseDuration(s), m, s);
});
test("duration parser rejects junk, zero and partial matches", () => {
  for (const s of ["", "abc", "0m", "0:00", "20m extra", "m20"]) assert.equal(parseDuration(s), null, s);
});
test("bare numbers use the default unit", () => {
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("2", "hours"), 120);
});
test("duration formatting", () => {
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(80), "1h 20m");
  assert.equal(formatDuration(195), "3h 15m");
  assert.equal(formatDuration(120), "2h");
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(0.4), "<1m");
  assert.equal(formatDuration(null), "–");
  assert.equal(formatSignedDuration(260), "+4h 20m");
  assert.equal(formatSignedDuration(-30), "−30m");
});

test("rolling ranges include today and have exact length", () => {
  const r = R("last7");
  assert.deepEqual([r.start, r.end], ["2026-09-23", "2026-09-29"]);
  assert.equal(diffDays(R("last14").start, R("last14").end) + 1, 14);
  assert.equal(R("lastN", "2026-09-29", 10).start, "2026-09-20");
});
test("today / yesterday / weeks respect week start", () => {
  assert.equal(R("yesterday").start, "2026-09-28");
  assert.deepEqual([R("thisWeek").start, R("thisWeek").end], ["2026-09-28", "2026-10-04"]); // Mon-Sun, 29 Sep is Tuesday
  assert.deepEqual([R("prevWeek").start, R("prevWeek").end], ["2026-09-21", "2026-09-27"]);
  assert.equal(startOfWeek("2026-09-29", 0), "2026-09-27");
});
test("month, year and since-ranges", () => {
  assert.deepEqual([R("thisMonth").start, R("thisMonth").end], ["2026-09-01", "2026-09-30"]);
  assert.deepEqual([R("prevMonth").start, R("prevMonth").end], ["2026-08-01", "2026-08-31"]);
  assert.deepEqual([R("thisYear").start, R("thisYear").end], ["2026-01-01", "2026-12-31"]);
  assert.deepEqual([R("prevYear").start, R("prevYear").end], ["2025-01-01", "2025-12-31"]);
  assert.deepEqual([R("sinceJan1").start, R("sinceJan1").end], ["2026-01-01", "2026-09-29"]);
  assert.equal(R("sinceInstall").start, "2026-03-10");
  const c = resolveRange({ id: "custom", custom: { start: "2026-05-10", end: "2026-05-01" } }, "2026-09-29", opts);
  assert.deepEqual([c.start, c.end], ["2026-05-01", "2026-05-10"]); // swapped when reversed
});
test("month and year boundaries", () => {
  assert.equal(R("prevMonth", "2026-01-15").start, "2025-12-01");
  assert.equal(R("prevMonth", "2026-03-31").end, "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftMonthStart("2026-01-31", -1), "2025-12-01");
  assert.equal(R("prevWeek", "2026-01-02").start, "2025-12-22");
});
test("leap years", () => {
  assert.ok(isLeapYear(2024) && isLeapYear(2000) && !isLeapYear(1900) && !isLeapYear(2026));
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(R("thisMonth", "2024-02-10").end, "2024-02-29");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(diffDays("2024-01-01", "2025-01-01"), 366);
  assert.ok(isDateKey("2024-02-29") && !isDateKey("2026-02-29") && !isDateKey("2026-13-01"));
});
test("previous ranges", () => {
  const p7 = previousRange(R("last7"), "2026-09-29");
  assert.deepEqual([p7.start, p7.end], ["2026-09-16", "2026-09-22"]);
  const pm = previousRange(R("thisMonth"), "2026-09-29");
  assert.deepEqual([pm.start, pm.end], ["2026-08-01", "2026-08-31"]);
  const aligned = previousRange(R("thisMonth", "2026-09-10"), "2026-09-10", true);
  assert.deepEqual([aligned.start, aligned.end], ["2026-08-01", "2026-08-10"]); // same 10 elapsed days
  const py = previousRange(R("thisYear"), "2026-09-29");
  assert.equal(py.start, "2025-01-01");
});
test("elapsed days never count the future", () => {
  assert.equal(elapsedDays(R("thisMonth"), "2026-09-29"), 29);
  assert.equal(elapsedDays(R("thisWeek"), "2026-09-29"), 2);
  assert.equal(elapsedDays({ start: "2026-10-01", end: "2026-10-31" }, "2026-09-29"), 0);
});

test("timezone: day keys follow local time and day math ignores DST", () => {
  const prev = process.env.TZ;
  try {
    for (const tz of ["America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      process.env.TZ = tz;
      const late = new Date(2026, 5, 30, 23, 30);
      assert.equal(toDateKey(late), "2026-06-30", tz);
      const iso = formatLocalIso(late);
      assert.ok(iso.startsWith("2026-06-30T23:30:00"), iso);
      assert.equal(Date.parse(iso), late.getTime(), tz);
    }
    process.env.TZ = "America/New_York";
    assert.equal(diffDays("2026-03-08", "2026-03-09"), 1); // 23-hour DST day
    assert.equal(diffDays("2026-11-01", "2026-11-02"), 1); // 25-hour DST day
    const { startMs, endMs } = rangeInstants({ start: "2026-03-08", end: "2026-03-08" });
    assert.equal((endMs - startMs) / 3600000, 23);
    process.env.TZ = "Asia/Kolkata";
    assert.ok(formatLocalIso(new Date(2026, 0, 1, 5, 10)).endsWith("+05:30"));
  } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
});

test("chart axis labels follow the chosen date format", () => {
  assert.deepEqual(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D MMM YYYY"].map((f) => formatShortDate("2026-09-05", f)), ["09-05", "05/09", "09/05", "5 Sep"]);
  assert.deepEqual(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "D MMM YYYY"].map((f) => formatMonthLabel("2026-09", f)), ["2026-09", "09/2026", "09/2026", "Sep 2026"]);
});

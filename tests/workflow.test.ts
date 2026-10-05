import { test } from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "../src/core/store";
import { MemIO, parse } from "./helpers";
import { starterTree } from "../src/core/defaults";
import { computeStats, filterByPath, rollup } from "../src/core/stats";
import { resolveRange } from "../src/core/dates";
import { pathKey } from "../src/core/hierarchy";
import { formatDuration } from "../src/core/duration";

test("spec workflow: 'Math Algebra 45m A' is parsed, saved, and every parent total updates", async () => {
  const now = new Date(2026, 8, 29, 5, 10);
  const store = new EventStore(new MemIO(), "T/Database", { clock: () => now });
  const tree = starterTree();
  const p = parse("Math Algebra 45m A #exam-preparation - Practiced 12 problems", now, tree);
  assert.deepEqual([p.path, p.durationMinutes, p.result], [["Academic", "Mathematics", "Algebra"], 45, "A"]);
  const r = await store.add({ timestamp: p.timestamp, path: p.path, durationMinutes: p.durationMinutes!, result: p.result, tags: p.tags, notes: p.notes, source: "manual" });
  assert.ok(r.ok);
  const roll = rollup(store.list());
  for (const path of [["Academic"], ["Academic", "Mathematics"], ["Academic", "Mathematics", "Algebra"]]) assert.equal(formatDuration(roll.get(pathKey(path))!.minutes), "45m");
  const month = computeStats(filterByPath(store.list(), ["Academic", "Mathematics"]), resolveRange({ id: "thisMonth" }, "2026-09-29", { weekStartsOn: 1 }), "2026-09-29");
  assert.equal(month.daysSinceLast, 0); assert.equal(month.activeDays, 1); assert.equal(month.calendarDays, 29);
});

test("performance: 50k events across stats/rollup stays interactive", () => {
  const events = Array.from({ length: 50000 }, (_, i) => { const d = new Date(2024, 0, 1 + (i % 900)); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return { id: `p${i}`, timestamp: `${date}T10:00:00+00:00`, date, path: ["Academic", "Mathematics", ["Algebra", "Geometry", "Statistics"][i % 3]], durationMinutes: 10 + (i % 50), tags: [], notes: "", source: "manual", createdAt: "", updatedAt: "" }; });
  const t0 = performance.now();
  computeStats(events, { start: "2024-01-01", end: "2026-09-29" }, "2026-09-29"); rollup(events);
  assert.ok(performance.now() - t0 < 1500, `took ${performance.now() - t0}ms`);
});

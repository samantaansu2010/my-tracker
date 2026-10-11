import { test } from "node:test";
import assert from "node:assert/strict";
import { recentEntries } from "../src/core/recent";
import { ev } from "./helpers";

const M = ["Academic", "Mathematics"], E = ["Academic", "English"];
const at = (d: string, h: string) => `${d}T${h}:00:00+00:00`;

test("recent entries: distinct combinations, most recent first, with counts", () => {
  const events = [ev("2026-10-01", 45, M, { timestamp: at("2026-10-01", "09") }), ev("2026-10-02", 30, E, { timestamp: at("2026-10-02", "09") }), ev("2026-10-03", 45, M, { timestamp: at("2026-10-03", "09") })];
  const r = recentEntries(events);
  assert.deepEqual(r.map((x) => [x.path[1], x.durationMinutes, x.count]), [["Mathematics", 45, 2], ["English", 30, 1]]);
  assert.equal(r[0].lastTimestamp, at("2026-10-03", "09"));
});
test("a different duration, result, type or tag set is a different entry; tag order does not matter", () => {
  const events = [ev("2026-10-01", 45, M, { tags: ["a", "b"] }), ev("2026-10-02", 45, M, { tags: ["b", "a"] }), ev("2026-10-03", 60, M), ev("2026-10-04", 45, M, { result: "A" }), ev("2026-10-05", 45, M, { kind: "Recall" })];
  const r = recentEntries(events, { limit: 10 });
  assert.equal(r.length, 4);
  assert.equal(r.find((x) => x.tags.join() === "a,b")!.count, 2);
});
test("notes and scores are not repeated; integration daily totals and empty data are handled; limit applies", () => {
  const withNotes = recentEntries([ev("2026-10-01", 45, M, { notes: "secret", scores: { recall: 8 } })])[0] as unknown as Record<string, unknown>;
  assert.equal(withNotes.notes, undefined); assert.equal(withNotes.scores, undefined);
  assert.deepEqual(recentEntries([]), []);
  assert.equal(recentEntries([ev("2026-10-01", 1380, ["Technology", "Computer", "Code"], { source: "activitywatch" })]).length, 0);
  const many = Array.from({ length: 9 }, (_, i) => ev(`2026-10-0${i + 1}`, 10 + i, M));
  assert.equal(recentEntries(many).length, 6); assert.equal(recentEntries(many, { limit: 3 }).length, 3); assert.equal(recentEntries(many, { limit: 0 }).length, 0);
});

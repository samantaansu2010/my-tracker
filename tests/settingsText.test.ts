import { test } from "node:test";
import assert from "node:assert/strict";
import { parseResultScale, serializeResultScale, parseMeasurements, serializeMeasurements, parseWeights, parseAwRules, serializeAwRules, parseIntervals, parseList } from "../src/core/settingsText";

test("result scale round trip and validation", () => {
  const r = parseResultScale("A=4, B=3, C=2, D=1");
  assert.deepEqual(r.value.map((x) => x.label), ["A", "B", "C", "D"]);
  assert.equal(serializeResultScale(r.value), "A=4, B=3, C=2, D=1");
  assert.ok(parseResultScale("A=4, A=3").error); assert.ok(parseResultScale("nonsense").error); assert.ok(parseResultScale("").error);
  assert.equal(parseResultScale("Excellent = 5, Good=3").value[0].label, "Excellent");
});
test("measurements round trip and validation", () => {
  const m = parseMeasurements("recall|Recall score|0|10|/10\naccuracy|Accuracy|0|100|%");
  assert.equal(m.value.length, 2); assert.equal(parseMeasurements(serializeMeasurements(m.value)).value[1].unit, "%");
  assert.ok(parseMeasurements("x|X|5|5|").error); assert.ok(parseMeasurements("bad key|X|0|1|").error); assert.ok(parseMeasurements("a|A|0|1\na|B|0|1").error);
});
test("weights, lists, intervals", () => {
  assert.deepEqual(parseWeights("recall=1, accuracy=0.5").value, { recall: 1, accuracy: 0.5 }); assert.ok(parseWeights("recall").error);
  assert.deepEqual(parseList("a, b\nb, c"), ["a", "b", "c"]);
  assert.deepEqual(parseIntervals("1, 3 7").value, [1, 3, 7]); assert.ok(parseIntervals("1, 0").error); assert.ok(parseIntervals("x").error);
});
test("ActivityWatch rules", () => {
  const r = parseAwRules("app | discord | Technology > Discord\ntitle | /^youtube/ | Personal > YouTube");
  assert.equal(r.value.length, 2); assert.equal(r.value[1].regex, true); assert.equal(r.value[1].pattern, "^youtube"); assert.deepEqual(r.value[0].path, ["Technology", "Discord"]);
  assert.equal(parseAwRules(serializeAwRules(r.value)).value[1].pattern, "^youtube");
  assert.ok(parseAwRules("bad line").error); assert.ok(parseAwRules("app | /([/ | X").error);
});

import { applyRenameToSettings, createDefaultSettings } from "../src/core/defaults";
test("renaming a subject updates targets, ActivityWatch rules and default category", () => {
  const s = createDefaultSettings("2026-09-01");
  s.targets = [{ id: "a", path: ["Academic", "Mathematics", "Algebra"], minutes: 60, period: "week" }, { id: "b", path: ["Academic", "English"], minutes: 60, period: "week" }];
  s.activityWatch.rules = [{ field: "app", pattern: "x", regex: false, path: ["Academic", "Mathematics"] }];
  applyRenameToSettings(s, ["Academic", "Mathematics"], ["Academic", "Maths"]);
  assert.deepEqual(s.targets[0].path, ["Academic", "Maths", "Algebra"]); assert.deepEqual(s.targets[1].path, ["Academic", "English"]); assert.deepEqual(s.activityWatch.rules[0].path, ["Academic", "Maths"]);
  applyRenameToSettings(s, ["Academic"], ["School"]);
  assert.equal(s.defaultCategory, "School"); assert.deepEqual(s.targets[1].path, ["School", "English"]);
});

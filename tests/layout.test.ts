import { test } from "node:test";
import assert from "node:assert/strict";
import { WIDGETS, defaultVisibility, isVisible, hiddenByUser, legacySectionsToVisibility, SIMPLE_ORDER, ADVANCED_ORDER, defaultVisible } from "../src/core/widgets";
import { createDefaultSettings, loadSettings } from "../src/core/defaults";
import { colorFor, PALETTE } from "../src/core/colors";
import { starterTree } from "../src/core/defaults";
import { bucketStartOf } from "../src/core/stats";

test("every widget id is unique and appears in the display order of the mode(s) it can show in", () => {
  const ids = WIDGETS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), [...ADVANCED_ORDER].sort());
  for (const id of SIMPLE_ORDER) assert.ok(ids.includes(id), id);
});
test("simple view is genuinely smaller than advanced by default, and advanced shows everything", () => {
  const v = defaultVisibility();
  const count = (m: "simple" | "advanced") => Object.values(v[m]).filter(Boolean).length;
  assert.ok(count("simple") <= 7 && count("simple") < count("advanced"));
  assert.equal(count("advanced"), WIDGETS.length);
  for (const id of ["today", "week", "goals"]) assert.ok(v.simple[id], id);
  for (const id of ["keyNumbers", "chartCumulative", "longestSessions", "peaks", "recall"]) assert.ok(!v.simple[id] && v.advanced[id], id);
});
test("visibility: explicit choice wins, missing entries fall back to the widget default, user-hidden widgets are listed", () => {
  const vis = { simple: { today: false }, advanced: {} };
  assert.equal(isVisible(vis, "simple", "today"), false);
  assert.equal(isVisible(vis, "simple", "week"), true);
  assert.equal(isVisible(vis, "simple", "peaks"), false);
  assert.equal(isVisible(undefined, "advanced", "peaks"), true);
  assert.equal(isVisible(vis, "advanced", "brand-new-widget"), false);
  assert.deepEqual(hiddenByUser(vis, "simple").map((w) => w.id), ["today"]);
  assert.equal(hiddenByUser(defaultVisibility(), "simple").length, 0); // defaults never nag
  assert.equal(defaultVisible("simple", "peaks"), false);
});
test("settings migration v1 -> v2 keeps the user's old section choices and the advanced view", () => {
  const old = { ...createDefaultSettings("2026-09-01"), schemaVersion: 1, rootFolder: "Tracking Folder", dashboard: { defaultRange: "last7", metrics: ["total"], sections: { today: true, recent: false, categories: true, analytics: false, targets: true, neglected: false, recall: true } } };
  const s = loadSettings(old, "2026-10-04");
  assert.equal(s.schemaVersion, 2); assert.equal(s.rootFolder, "Tracking Folder"); assert.equal(s.dashboard.mode, "advanced"); assert.equal(s.dashboard.defaultRange, "last7");
  assert.equal(s.dashboard.visibility.advanced.recent, false); assert.equal(s.dashboard.visibility.advanced.attention, false);
  assert.equal(s.dashboard.visibility.advanced.peaks, false); assert.equal(s.dashboard.visibility.advanced.chartCumulative, false);
  assert.equal(s.dashboard.visibility.advanced.today, true); assert.equal(s.dashboard.visibility.advanced.breakdown, true); assert.equal(s.dashboard.visibility.advanced.recall, true);
  assert.equal(s.dashboard.visibility.simple.week, true); // simple profile gets defaults
  assert.equal((s.dashboard as any).sections, undefined);
  assert.deepEqual(legacySectionsToVisibility({ today: false, junk: 1 }), { today: false });
});
test("fresh installs start in simple view and new settings round-trip", () => {
  const s = loadSettings(undefined, "2026-10-04");
  assert.equal(s.dashboard.mode, "simple");
  const again = loadSettings(JSON.parse(JSON.stringify(s)), "2026-10-05");
  assert.deepEqual(again.dashboard, s.dashboard);
});
test("colours are stable, distinct among siblings, and overridable", () => {
  const tree = starterTree();
  const c = (p: string[]) => colorFor(p, tree);
  assert.equal(c(["Academic"]), c(["Academic"]));
  assert.notEqual(c(["Academic"]), c(["Technology"]));
  const subs = ["Mathematics", "English", "Physical Science"].map((n) => c(["Academic", n]));
  assert.equal(new Set(subs).size, 3);
  assert.equal(c(["Academic", "Mathematics", "Algebra"]), c(["Academic", "Mathematics"])); // deeper levels inherit
  const all = [["Academic"], ["Technology"], ["Academic", "Mathematics"], ["Academic", "English"], ["Academic", "Physical Science"], ["Technology", "Programming"], ["Technology", "Computer"]].map(c);
  assert.equal(new Set(all).size, all.length); // categories and subjects never share a colour (starter tree)
  tree[0].children[0].color = "pink";
  assert.equal(c(["Academic", "Mathematics", "Algebra"]), "pink");
  assert.ok(PALETTE.includes(c(["Not", "In", "Tree"])) && c(["Not", "In", "Tree"]) === c(["Not", "In", "Tree"]));
});
test("bucket starts", () => {
  assert.equal(bucketStartOf("2026-10-04", "week", 1), "2026-09-28");
  assert.equal(bucketStartOf("2026-10-04", "month", 1), "2026-10-01");
  assert.equal(bucketStartOf("2026-10-04", "day", 1), "2026-10-04");
});

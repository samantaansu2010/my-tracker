import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./helpers";
import { starterTree } from "../src/core/defaults";
import { buildIndex, suggest, canonicalizePath, ensurePath, renameNode, removeNode, findNode, makeNode, flatten } from "../src/core/hierarchy";
import { parseQuestion } from "../src/core/queryText";
import { editDistance, scoreMatch, normalize } from "../src/core/text";

const NOW = new Date(2026, 8, 29, 10, 0);

test("spec example inputs resolve correctly", () => {
  const a = parse("Math Algebra 45m A", NOW);
  assert.deepEqual(a.path, ["Academic", "Mathematics", "Algebra"]);
  assert.equal(a.durationMinutes, 45); assert.equal(a.result, "A"); assert.deepEqual(a.errors, []); assert.deepEqual(a.warnings, []);
  assert.equal(a.existingDepth, 3);
  const b = parse("Physical Science 1h 20m", NOW);
  assert.deepEqual(b.path, ["Academic", "Physical Science"]); assert.equal(b.durationMinutes, 80); assert.equal(b.result, undefined);
  const c = parse("English 30 min B", NOW);
  assert.deepEqual(c.path, ["Academic", "English"]); assert.equal(c.durationMinutes, 30); assert.equal(c.result, "B");
  const d = parse("Programming JavaScript 2h A", NOW);
  assert.deepEqual(d.path, ["Technology", "Programming", "JavaScript"]); assert.equal(d.durationMinutes, 120); assert.equal(d.result, "A");
});
test("aliases, typos and canonical names", () => {
  assert.deepEqual(parse("MATH 20m", NOW).path, ["Academic", "Mathematics"]);
  assert.deepEqual(parse("Physics 1h", NOW).path, ["Academic", "Physical Science"]);
  assert.deepEqual(parse("JS 1h", NOW).path, ["Technology", "Programming", "JavaScript"]);
  assert.deepEqual(parse("Mathamatics 20m", NOW).path, ["Academic", "Mathematics"]);  // typo
  assert.deepEqual(parse("Engilsh 20m", NOW).path, ["Academic", "English"]);          // transposition
  assert.deepEqual(parse("math, algebra 20m", NOW).path, ["Academic", "Mathematics", "Algebra"]);
  assert.deepEqual(parse("Math > Algebra > 20m", NOW).path, ["Academic", "Mathematics", "Algebra"]);
});
test("unknown subjects become new nodes with a warning, not silent duplicates", () => {
  const p = parse("Chess 30m", NOW);
  assert.deepEqual(p.path, ["Academic", "Chess"]); assert.equal(p.existingDepth, 1); assert.equal(p.warnings.length, 1);
  const q = parse("Math quadratic equations 30m", NOW);
  assert.deepEqual(q.path, ["Academic", "Mathematics", "Quadratic Equations"]); assert.equal(q.existingDepth, 2);
});
test("tags, notes, time, date, kind, planned, scores", () => {
  const p = parse("Math Algebra 45m A #exam-preparation #Exam-Preparation @14:30 yesterday kind:recall planned:1h recall:8/10 accuracy:85% - Practiced 12 problems", NOW);
  assert.deepEqual(p.tags, ["exam-preparation"]);
  assert.equal(p.notes, "Practiced 12 problems");
  assert.equal(p.date, "2026-09-28"); assert.ok(p.timestamp.startsWith("2026-09-28T14:30:00"));
  assert.equal(p.kind, "Recall"); assert.equal(p.plannedMinutes, 60); assert.deepEqual(p.scores, { recall: 8, accuracy: 85 });
  assert.deepEqual(p.path, ["Academic", "Mathematics", "Algebra"]);
  assert.equal(parse("English 30m @9pm", NOW).timestamp.slice(11, 16), "21:00");
  assert.equal(parse("English 30m 2026-09-01", NOW).date, "2026-09-01");
});
test("reading is a subject when it exists, kind only otherwise", () => {
  const t = starterTree(); t[0].children.push(makeNode("Reading"));
  assert.deepEqual(parse("Reading 30m", NOW, t).path, ["Academic", "Reading"]);
  assert.equal(parse("Reading 30m", NOW, t).kind, undefined);
  const p = parse("Math recall 30m", NOW);
  assert.equal(p.kind, "Recall"); assert.deepEqual(p.path, ["Academic", "Mathematics"]);
});
test("errors for missing duration / subject / absurd durations", () => {
  assert.ok(parse("Math", NOW).errors.some((e) => /duration/i.test(e)));
  assert.ok(parse("45m", NOW).errors.some((e) => /subject/i.test(e)));
  assert.equal(parse("Math 25h", NOW).durationMinutes, null);
  assert.equal(parse("Math 0m", NOW).durationMinutes, null);
  assert.equal(parse("", NOW).errors.length, 2);
});
test("bare number uses default unit", () => {
  assert.equal(parse("Math 45", NOW).durationMinutes, 45);
});

test("fuzzy scoring", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("ab", "ba"), 1);
  assert.ok(scoreMatch("math", "mathematics") > 80);
  assert.equal(scoreMatch("jav", "javascript", 1) > 0, true);
  assert.equal(scoreMatch("xyz", "mathematics"), 0);
  assert.equal(normalize("  Quadratic—Équations! "), "quadratic equations");
});
test("autocomplete suggests canonical subjects", () => {
  const tree = starterTree();
  assert.equal(suggest("MATH", tree)[0].entry.node.name, "Mathematics");
  assert.equal(suggest("phys", tree)[0].entry.node.name, "Physical Science");
  assert.equal(suggest("jav", tree)[0].entry.node.name, "JavaScript");
  assert.equal(suggest("", tree).length, 0);
});
test("tree editing: ensure, canonicalize, rename, remove, unlimited depth", () => {
  const tree = starterTree();
  assert.deepEqual(canonicalizePath(tree, ["academic", "MATHEMATICS", "algebra", "Foo"]), ["Academic", "Mathematics", "Algebra", "Foo"]);
  const created = ensurePath(tree, ["Academic", "Mathematics", "Algebra", "Polynomials", "Roots", "Complex", "Deep"]);
  assert.equal(created.length, 4);
  assert.ok(findNode(tree, ["academic", "mathematics", "algebra", "polynomials", "roots", "complex", "deep"]));
  assert.equal(ensurePath(tree, ["Academic", "Mathematics"]).length, 0);
  assert.deepEqual(renameNode(tree, ["Academic", "English"], "Mathematics"), { ok: false, error: '"Mathematics" already exists at this level' });
  assert.deepEqual(renameNode(tree, ["Academic", "English"], "Literature"), { ok: true });
  assert.ok(removeNode(tree, ["Academic", "Literature"]));
  assert.ok(!removeNode(tree, ["Nope"]));
  assert.ok(flatten(tree).some((f) => f.path.length === 7));
  assert.ok(buildIndex(tree).length > 5);
});
test("natural-language questions", () => {
  const tree = starterTree();
  let q = parseQuestion("How much Mathematics did I do in the last 14 days?", tree);
  assert.deepEqual(q.path, ["Academic", "Mathematics"]); assert.deepEqual(q.range, { id: "lastN", n: 14 }); assert.equal(q.compare, false);
  q = parseQuestion("How much Physical Science did I study this month?", tree);
  assert.deepEqual(q.path, ["Academic", "Physical Science"]); assert.equal(q.range.id, "thisMonth");
  q = parseQuestion("How much computer time did I have in the last 30 days?", tree);
  assert.deepEqual(q.path, ["Technology", "Computer"]);
  q = parseQuestion("How much Mathematics > Algebra did I do this month?", tree);
  assert.deepEqual(q.path, ["Academic", "Mathematics", "Algebra"]);
  q = parseQuestion("Compare English this month with last month", tree);
  assert.deepEqual(q.path, ["Academic", "English"]); assert.equal(q.range.id, "thisMonth"); assert.equal(q.compare, true);
  assert.deepEqual(parseQuestion("how much did I do today", tree).path, []);
});

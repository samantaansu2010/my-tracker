import { test } from "node:test";
import assert from "node:assert/strict";
import { EventStore, type NewEvent } from "../src/core/store";
import { MemIO } from "./helpers";
import { validateEvent } from "../src/core/integrity";
import { migrateRecord } from "../src/core/migrate";
import { buildBundle, parseBundle, eventsToCsv, csvToRawEvents, parseCsv } from "../src/core/importExport";
import { createDefaultSettings, loadSettings, deepMerge } from "../src/core/defaults";
import { createBackup, pruneBackups, backupDue } from "../src/core/backup";
import { aggregateAw, splitAcrossDays, mapEvent, fetchWindowEvents, type HttpFn } from "../src/integrations/activitywatch";
import { buildReport } from "../src/core/report";
import { resolveRange } from "../src/core/dates";
import { starterTree } from "../src/core/defaults";
import { ev } from "./helpers";

const DIR = "Tracking/Database";
const clock = () => new Date(2026, 8, 29, 10, 0, 0);
const mk = (io = new MemIO()) => ({ io, store: new EventStore(io, DIR, { clock }) });
const base = (o: Partial<NewEvent> = {}): NewEvent => ({ timestamp: "2026-09-29T05:10:00+05:30", path: ["Academic", "Mathematics", "Algebra"], durationMinutes: 45, result: "A", tags: ["exam"], notes: "Practiced 12 problems", source: "manual", ...o });

test("add persists and survives reload with all fields", async () => {
  const { io, store } = mk();
  const r = await store.add(base());
  assert.ok(r.ok);
  const s2 = new EventStore(io, DIR, { clock });
  const rep = await s2.load();
  assert.equal(rep.events, 1);
  const e = s2.list()[0];
  assert.equal(e.date, "2026-09-29"); assert.equal(e.durationMinutes, 45); assert.deepEqual(e.path, ["Academic", "Mathematics", "Algebra"]); assert.equal(e.result, "A");
  assert.match(e.id, /^evt_/);
});
test("duplicate prevention: identical events blocked unless forced; external ids unique", async () => {
  const { store } = mk();
  assert.ok((await store.add(base())).ok);
  const dup = await store.add(base());
  assert.ok(!dup.ok && dup.reason === "duplicate");
  assert.equal(store.size, 1);
  assert.ok((await store.add(base(), { allowDuplicate: true })).ok);
  assert.ok((await store.add(base({ durationMinutes: 46 }))).ok);
  assert.ok((await store.add(base({ externalId: "x1", notes: "a" }))).ok);
  const again = await store.add(base({ externalId: "x1", notes: "b" }));
  assert.ok(!again.ok && again.reason === "duplicate");
  const sameId = await store.add(base({ id: store.list()[0].id, notes: "zzz" }));
  assert.ok(!sameId.ok);
});
test("validation rejects malformed events and never stores them", async () => {
  const { store } = mk();
  for (const bad of [base({ durationMinutes: 0 }), base({ durationMinutes: NaN }), base({ durationMinutes: 1441 }), base({ path: [] }), base({ path: ["A", ""] }), base({ timestamp: "garbage" }), base({ timestamp: "2026-02-30T10:00:00+00:00" })]) {
    const r = await store.add(bad);
    assert.ok(!r.ok && r.reason === "invalid", JSON.stringify(bad));
  }
  assert.equal(store.size, 0);
  assert.ok(validateEvent(null).ok === false && validateEvent([]).ok === false);
});
test("edit, delete and undo are safe and reversible", async () => {
  const { io, store } = mk();
  const id = (await store.add(base()) as any).value.id;
  const upd = await store.update(id, { durationMinutes: 60, notes: "edited" });
  assert.ok(upd.ok); assert.equal(store.get(id)!.durationMinutes, 60);
  assert.equal(store.get(id)!.createdAt, upd.ok ? upd.value.createdAt : "");
  assert.ok(!(await store.update(id, { durationMinutes: -5 })).ok);
  assert.equal(store.get(id)!.durationMinutes, 60);
  assert.ok((await store.undo()).ok); assert.equal(store.get(id)!.durationMinutes, 45);
  assert.ok((await store.remove(id)).ok); assert.equal(store.size, 0);
  assert.ok((await store.undo()).ok); assert.equal(store.size, 1);
  const s2 = new EventStore(io, DIR, { clock }); await s2.load();
  assert.equal(s2.size, 1); assert.equal(s2.get(id)!.durationMinutes, 45);
  assert.ok((await store.undo()).ok); assert.equal(store.size, 0); // undoes the original add
  assert.equal((await store.undo()).ok, false);                    // nothing left to undo, nothing breaks
  assert.equal(store.canUndo, false);
  assert.ok(!(await store.remove("nope")).ok);
});
test("deleting then re-adding keeps history append-only (file only grows)", async () => {
  const { io, store } = mk();
  const id = (await store.add(base()) as any).value.id;
  const before = io.files.get(`${DIR}/events-2026.jsonl`)!.length;
  await store.remove(id);
  assert.ok(io.files.get(`${DIR}/events-2026.jsonl`)!.length > before);
});
test("rename path rewrites matching events only, and is undoable", async () => {
  const { store } = mk();
  await store.add(base()); await store.add(base({ path: ["Academic", "Mathematics"], notes: "n" })); await store.add(base({ path: ["Academic", "English"], notes: "e" }));
  const r = await store.renamePath(["Academic", "Mathematics"], ["Academic", "Maths"]);
  assert.ok(r.ok && r.value === 2);
  assert.deepEqual(store.list().map((e) => e.path.join("/")).sort(), ["Academic/English", "Academic/Maths", "Academic/Maths/Algebra"]);
  await store.undo();
  assert.ok(store.list().every((e) => !e.path.includes("Maths")));
  const none = await store.renamePath(["Nope"], ["X"]);
  assert.ok(none.ok && none.value === 0);
});
test("corrupted lines are quarantined, valid data is recovered, nothing is discarded", async () => {
  const { io, store } = mk();
  await store.add(base()); await store.add(base({ durationMinutes: 10 }));
  const f = `${DIR}/events-2026.jsonl`;
  io.files.set(f, io.files.get(f)! + "this is not json\n" + JSON.stringify({ v: 1, op: "put", at: "x", event: { id: "bad" } }) + "\n" + JSON.stringify({ v: 99, op: "put", at: "x", event: {} }) + "\n" + '{"v":1,"op":"put","at":"x","event":{"id":"trunc"');
  const s2 = new EventStore(io, DIR, { clock });
  const rep = await s2.load();
  assert.equal(rep.events, 2); assert.equal(rep.quarantined.length, 4);
  assert.ok(rep.quarantined.some((q) => /newer/.test(q.reason)));
  const q = io.files.get(`${DIR}/quarantine.jsonl`)!;
  assert.equal(q.trim().split("\n").length, 4); assert.ok(q.includes("this is not json"));
  assert.ok(io.files.get(f)!.includes("this is not json")); // original file untouched
  const rep2 = await s2.load(); // reloading doesn't duplicate quarantine entries
  assert.equal(rep2.newlyQuarantined, 0); assert.equal(io.files.get(`${DIR}/quarantine.jsonl`)!.trim().split("\n").length, 4);
  assert.ok((await s2.add(base({ durationMinutes: 99 }))).ok); // appending after a truncated last line stays parseable
  const s3 = new EventStore(io, DIR, { clock }); await s3.load();
  assert.equal(s3.size, 3);
});
test("schema versioning and migrations", () => {
  const mig = [{ from: 1, migrate: (r: any) => ({ ...r, renamed: r.old }) }, { from: 2, migrate: (r: any) => ({ ...r, extra2: true }) }];
  const r = migrateRecord({ v: 1, old: "x" }, 3, mig);
  assert.ok(r.ok && r.record.renamed === "x" && r.record.extra2 === true && r.record.v === 3);
  assert.ok(!migrateRecord({ v: 4 }, 3, mig).ok);
  assert.ok(!migrateRecord({ v: 1 }, 3, [mig[1]]).ok);
  const same = migrateRecord({ v: 3 }, 3, mig); assert.ok(same.ok && !same.migrated);
});
test("migrations apply while loading the store", async () => {
  const io = new MemIO();
  io.files.set(`${DIR}/events-2026.jsonl`, JSON.stringify({ v: 1, op: "put", at: "x", event: { id: "a", timestamp: "2026-09-01T10:00:00+00:00", path: ["A"], minutes: 30, tags: [], notes: "", source: "manual" } }) + "\n");
  const s = new EventStore(io, DIR, { clock, schemaVersion: 2, migrations: [{ from: 1, migrate: (r: any) => ({ ...r, event: { ...r.event, durationMinutes: r.event.minutes } }) }] });
  const rep = await s.load();
  assert.equal(rep.events, 1); assert.equal(s.get("a")!.durationMinutes, 30); assert.equal(s.get("a")!.extra?.minutes, 30); // unknown fields preserved
});
test("unknown fields are preserved through edits", async () => {
  const { store } = mk();
  const id = (await store.add({ ...base(), ...({ mood: "good" } as any) }) as any).value.id;
  assert.equal(store.get(id)!.extra?.mood, "good");
  await store.update(id, { notes: "x" });
  assert.equal(store.get(id)!.extra?.mood, "good");
});

test("JSON export/import round trip is lossless and idempotent", async () => {
  const { store } = mk();
  await store.add(base({ scores: { recall: 8 }, plannedMinutes: 60, kind: "Recall" })); await store.add(base({ notes: "second", path: ["Technology", "Programming"] }));
  const bundle = buildBundle(store.list(), createDefaultSettings("2026-09-01"), clock());
  const parsed = parseBundle(JSON.stringify(bundle));
  assert.equal(parsed.error, undefined);
  const { store: fresh } = mk();
  const rep = await fresh.addMany(parsed.events);
  assert.equal(rep.added, 2);
  assert.deepEqual(fresh.list(), store.list());
  const again = await fresh.addMany(parsed.events);
  assert.equal(again.added, 0); assert.equal(again.duplicates, 2);
});
test("import reports invalid rows, id conflicts and in-file duplicates without losing them", async () => {
  const { store } = mk();
  const id = (await store.add(base()) as any).value.id;
  const rows = [{ ...store.get(id)!, notes: "different content, same id" }, { id: "x1", timestamp: "2026-09-01T10:00:00+00:00", path: ["A"], durationMinutes: 5 }, { id: "x2", timestamp: "2026-09-01T10:00:00+00:00", path: ["A"], durationMinutes: 5 }, { id: "bad", durationMinutes: "lots" }, 42];
  const rep = await store.addMany(rows);
  assert.equal(rep.conflicts, 1); assert.equal(rep.added, 1); assert.equal(rep.duplicates, 1); assert.equal(rep.invalid.length, 2);
  assert.equal(store.get(id)!.notes, "Practiced 12 problems"); // existing never overwritten
});
test("parseBundle rejects garbage and future schemas", () => {
  assert.ok(parseBundle("nope").error); assert.ok(parseBundle('{"a":1}').error);
  assert.ok(parseBundle(JSON.stringify({ app: "my-tracker", schemaVersion: 99, events: [] })).error);
  assert.deepEqual(parseBundle("[1]").events, [1]);
});
test("CSV export/import round trip with commas, quotes and newlines", async () => {
  const { store } = mk();
  await store.add(base({ notes: 'He said "hi", then\nleft', tags: ["a", "b"], scores: { recall: 7 }, path: ["A", "B", "C", "D", "E"] }));
  const csv = eventsToCsv(store.list());
  assert.equal(parseCsv(csv).length, 2);
  const raw = csvToRawEvents(csv);
  const { store: fresh } = mk();
  const rep = await fresh.addMany(raw);
  assert.equal(rep.added, 1);
  const a = store.list()[0], b = fresh.list()[0];
  assert.equal(b.notes, a.notes); assert.deepEqual(b.tags, a.tags); assert.deepEqual(b.path, a.path); assert.deepEqual(b.scores, a.scores); assert.equal(b.id, a.id);
});
test("CSV import from a hand-written sheet", async () => {
  const csv = "Date,Time,Category,Subject,Duration,Result\n2026-09-01,08:30,Academic,Mathematics,1h 30m,A\n2026-09-02,,Academic,English,45,B\n2026-09-03,,Academic,English,oops,B\n";
  const { store } = mk();
  const rep = await store.addMany(csvToRawEvents(csv));
  assert.equal(rep.added, 2); assert.equal(rep.invalid.length, 1);
  assert.equal(store.list()[0].durationMinutes, 90); assert.equal(store.list()[0].timestamp.slice(0, 16), "2026-09-01T08:30");
  assert.equal(store.list()[1].source, "import");
});

test("settings: defaults fill gaps, saved values win, unknown keys survive", () => {
  const d = createDefaultSettings("2026-09-01");
  const s = loadSettings({ rootFolder: "Track", dashboard: { defaultRange: "last7" }, futureKey: 1, tree: [] }, "2026-09-02");
  assert.equal(s.rootFolder, "Track"); assert.equal(s.dashboard.defaultRange, "last7"); assert.deepEqual(s.dashboard.visibility, d.dashboard.visibility); assert.equal(s.dashboard.mode, "advanced"); assert.equal((s.dashboard as Record<string, unknown>).sections, undefined);
  assert.deepEqual(s.tree, []); assert.equal((s as any).futureKey, 1);
  assert.equal(loadSettings(undefined, "2026-09-02").installDate, "2026-09-02");
  assert.deepEqual(deepMerge({ a: 1, b: { c: 2 } }, { b: { c: "wrong-type" } }), { a: 1, b: { c: 2 } });
  assert.equal(loadSettings({ schemaVersion: 99, rootFolder: "X" }, "2026-09-02").rootFolder, "X");
});
test("backups: create, prune, schedule", async () => {
  const { io, store } = mk();
  await store.add(base());
  for (let i = 0; i < 5; i++) await createBackup(io, "Tracking/Backups", store, undefined, new Date(2026, 8, 20 + i, 9, 0, 0));
  assert.equal((await io.list("Tracking/Backups")).length, 5);
  const removed = await pruneBackups(io, "Tracking/Backups", 3);
  assert.equal(removed.length, 2); assert.equal((await io.list("Tracking/Backups")).length, 3);
  assert.ok(removed.every((r) => r.includes("0920") || r.includes("0921")));
  const same = await createBackup(io, "Tracking/Backups", store, undefined, new Date(2026, 8, 24, 9, 0, 0));
  assert.match(same, /-1\.json$/); // never overwrites
  assert.ok(backupDue(null, 1, clock()) && !backupDue("2026-09-29T09:00:00+00:00", 1, new Date("2026-09-29T10:00:00Z")) && backupDue("2026-09-27T09:00:00Z", 1, new Date("2026-09-29T10:00:00Z")));
});

test("ActivityWatch: midnight splitting, mapping, daily aggregation, idempotent ids", () => {
  const start = new Date(2026, 8, 28, 23, 50, 0).getTime();
  const parts = splitAcrossDays(start, 1200);
  assert.deepEqual(parts.map((p) => [p.date, p.seconds]), [["2026-09-28", 600], ["2026-09-29", 600]]);
  const events = [
    { timestamp: new Date(2026, 8, 29, 9, 0).toISOString(), duration: 1800, data: { app: "Discord.exe", title: "x" } },
    { timestamp: new Date(2026, 8, 29, 10, 0).toISOString(), duration: 1800, data: { app: "Code.exe", title: "proj.ts" } },
    { timestamp: new Date(2026, 8, 29, 11, 0).toISOString(), duration: 600, data: { app: "Code.exe" } },
    { timestamp: new Date(2026, 8, 29, 12, 0).toISOString(), duration: 5, data: { app: "Tiny" } },
    { timestamp: "bad", duration: 100, data: {} },
  ];
  const rules = [{ field: "app" as const, pattern: "code", regex: false, path: ["Technology", "Programming"] }];
  const agg = aggregateAw(events, rules);
  assert.equal(agg.length, 2);
  assert.deepEqual(agg.find((a) => a.path[2] === "Discord")!.minutes, 30);
  assert.equal(agg.find((a) => a.path[1] === "Programming")!.minutes, 40);
  assert.equal(aggregateAw(events, rules)[0].externalId, agg[0].externalId);
  assert.deepEqual(mapEvent({ timestamp: "", duration: 1, data: { title: "YouTube - x" } }, [{ field: "title", pattern: "^youtube", regex: true, path: ["Y"] }]), ["Y"]);
  assert.deepEqual(mapEvent({ timestamp: "", duration: 1, data: { app: "Foo" } }, [{ field: "app", pattern: "([", regex: true, path: ["Z"] }]), ["Technology", "Computer", "Foo"]); // bad regex ignored
});
test("ActivityWatch sync upserts without duplicating and rolls up under Computer", async () => {
  const { store } = mk();
  const inputs = (m: number) => [{ timestamp: "2026-09-29T12:00:00+00:00", path: ["Technology", "Computer", "Discord"], durationMinutes: m, tags: [], notes: "", source: "activitywatch", externalId: "aw:2026-09-29:D" }, { timestamp: "2026-09-29T12:00:00+00:00", path: ["Technology", "Computer", "Code"], durationMinutes: 100, tags: [], notes: "", source: "activitywatch", externalId: "aw:2026-09-29:C" }];
  let r = await store.upsertExternal(inputs(68)); assert.ok(r.ok && r.value.added === 2);
  r = await store.upsertExternal(inputs(68)); assert.ok(r.ok && r.value.unchanged === 2 && r.value.added === 0);
  r = await store.upsertExternal(inputs(80)); assert.ok(r.ok && r.value.updated === 1);
  assert.equal(store.size, 2); assert.equal(store.list().find((e) => e.path[2] === "Discord")!.durationMinutes, 80);
});
test("ActivityWatch fetch falls back when no AFK watcher exists", async () => {
  const calls: string[] = [];
  const http: HttpFn = async (req) => { calls.push(req.body ?? ""); return calls.length === 1 ? { status: 500, json: {} } : { status: 200, json: [[{ timestamp: "t", duration: 1, data: {} }]] }; };
  const r = await fetchWindowEvents(http, "http://localhost:5600/", "2026-09-01", "2026-09-02");
  assert.equal(r.length, 1); assert.equal(calls.length, 2); assert.ok(calls[0].includes("afk") && !calls[1].includes("afk"));
  await assert.rejects(fetchWindowEvents(async () => ({ status: 500, json: null }), "http://x", "2026-09-01", "2026-09-02"));
});
test("report renders with frontmatter and correct comparisons", () => {
  const events = [ev("2026-09-10", 60, ["Academic", "Mathematics", "Algebra"]), ev("2026-08-10", 30, ["Academic", "Mathematics"])];
  const md = buildReport(resolveRange({ id: "thisMonth" }, "2026-09-29", { weekStartsOn: 1 }), events, starterTree(), "2026-09-29", ["total", "consistency"]);
  assert.ok(md.startsWith("---\ntype: my-tracker-report")); assert.ok(md.includes("total_minutes: 60")); assert.ok(md.includes("+30m") || md.includes("1h vs 30m"));
  assert.ok(md.includes("+100.0%"));
});

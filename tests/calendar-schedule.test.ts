import { test } from "node:test";
import assert from "node:assert/strict";
import { EventStore, type NewEvent } from "../src/core/store";
import { MemIO } from "./helpers";
import { eventsToCsv, csvToRawEvents, buildBundle, parseBundle } from "../src/core/importExport";
import { isCompleted, isScheduled } from "../src/core/schedule";

const base = (o: Partial<NewEvent> = {}): NewEvent => ({
  timestamp: "2026-10-12T09:00:00+05:30",
  path: ["Academic", "Mathematics"],
  durationMinutes: 45,
  tags: [],
  notes: "",
  source: "manual",
  ...o,
});

test("scheduled records are separate from completed-time queries", async () => {
  const store = new EventStore(new MemIO(), "Tracking/Database", { clock: () => new Date("2026-10-12T12:00:00+05:30") });
  const completed = await store.add(base());
  const scheduled = await store.add(base({ status: "scheduled" }));
  assert.equal(completed.ok, true);
  assert.equal(scheduled.ok, true);
  assert.equal(store.list().length, 1);
  assert.equal(store.listScheduled().length, 1);
  assert.equal(store.listAll().length, 2);
  assert.equal(isCompleted(store.list()[0]), true);
  assert.equal(isScheduled(store.listScheduled()[0]), true);
});

test("scheduled status survives CSV and JSON exports", async () => {
  const store = new EventStore(new MemIO(), "Tracking/Database");
  assert.equal((await store.add(base({ status: "scheduled" }))).ok, true);
  const csv = eventsToCsv(store.listAll());
  assert.match(csv.split("\r\n")[0], /status$/);
  assert.equal((csvToRawEvents(csv)[0] as { status?: string }).status, "scheduled");
  const bundle = buildBundle(store.listAll(), undefined, new Date("2026-10-12T12:00:00Z"));
  const parsed = parseBundle(JSON.stringify(bundle));
  assert.equal((parsed.events[0] as { status?: string }).status, "scheduled");
});

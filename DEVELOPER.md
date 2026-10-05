# My Tracker — developer guide

> **0.1.0 is feature-frozen for the first public release.** Only bug fixes and release polish until it is published. Planned right after release, in this order: (1) one-tap repeat entries, (2) goal creation from the dashboard, (3) per-device log files.

A local-first analytics plugin for Obsidian. TypeScript, no runtime dependencies, bundled with esbuild.
Design rule: **raw events in, derived statistics out.** Nothing derived is ever persisted.

## 1. Status (read this first)

| Area | State |
|---|---|
| `src/core/**` (engine) | Complete, type-checked, **80 passing tests** |
| `src/integrations/activitywatch.ts` | Unit-tested against fake HTTP only; never run against a real ActivityWatch server |
| `src/ui/**`, `src/main.ts` | Runs in Obsidian 1.13.7 (verified from user screenshots of the first version). The Simple/Advanced redesign (widgets, rings, stacked charts, Customize window) is type-checked but not yet seen running |
| `main.js` bundle | Not produced yet (esbuild couldn't be installed in the authoring sandbox) |

## 2. Setup

```bash
npm install
npm test            # tsx --test tests/*.test.ts  (Node ≥ 18)
npm run typecheck   # tsc --noEmit
npm run dev         # esbuild watch → main.js
npm run build       # typecheck + production bundle
```
Symlink or copy the folder into `<test vault>/.obsidian/plugins/my-tracker/` (needs `main.js`, `manifest.json`, `styles.css`). Use the Hot Reload plugin or toggle the plugin after rebuilds.

## 3. Architecture

```
src/core/            Pure TS. Never import "obsidian". All logic worth testing lives here.
  types.ts           TrackerEvent, SubjectNode, TrackerSettings, RangeSpec, schema constants
  duration.ts        parse/format durations (everything is minutes)
  dates.ts           YYYY-MM-DD arithmetic (UTC math → DST-proof), range presets, previousRange, periodRange
  text.ts            normalize, edit distance (OSA), scoreMatch
  hierarchy.ts       tree ops, alias index, rankNodes/suggest, path helpers
  parser.ts          natural-language entry → ParsedEntry; resolveTokens (subject chain resolution)
  queryText.ts       "How much Math last 14 days?" → {path, range, compare}
  stats.ts           computeStats, rollup, distribution, series/bucket helpers, trend, gaps
  compare.ts         percentChange, delta, compareStats (zero-safe)
  targets.ts neglect.ts recall.ts performance.ts metrics.ts   derived analytics
  integrity.ts       validateEvent, normalizeRaw, fingerprint
  migrate.ts         versioned record migration chain
  store.ts           EventStore: append-only log, undo, import, external upsert
  importExport.ts backup.ts report.ts defaults.ts settingsText.ts
  widgets.ts         dashboard widget registry, per-mode visibility, order, legacy-settings mapping
  colors.ts          palette + colorFor(path, tree): stable, distinct, overridable subject colours
src/integrations/    activitywatch.ts (HTTP injected, so testable)
src/obsidianIO.ts    StorageIO over vault.adapter; folder creation
src/host.ts          TrackerHost interface: what UI may use from the plugin
src/ui/              dashboard (ItemView; Simple/Advanced renderers), charts (SVG/HTML: stacked bars, rings),
                     layoutEditor (Customize modal + settings toggles), trackModal, drilldown, settingsTab,
                     setupWizard, modals (query/import/range picker), codeblock
src/main.ts          Plugin: wiring, commands, backups, ActivityWatch sync, report generation
```
Dependency direction: `ui → host/core`, `main → everything`, `core → nothing external`. UI components receive a `TrackerHost`, not the Plugin class.

## 4. Data model

```ts
interface TrackerEvent {
  id: string;                 // "evt_<time36><random>"
  timestamp: string;          // local ISO with offset: 2026-09-29T05:10:00+05:30
  date: string;               // local YYYY-MM-DD at entry time. ALL day-based queries use this
  path: string[];             // [category, subject, subsubject, topic, ...] canonical names
  durationMinutes: number;    // 0 < d ≤ 1440
  kind?, result?, scores?, plannedMinutes?, tags[], notes, source, externalId?, createdAt, updatedAt
  extra?: Record<string, unknown>   // unknown fields preserved
}
```
`category/subject/subsubject/topic` are derived views of `path` (`categoryOf`, `subjectOf`, …), not stored separately.

### Storage: append-only op log
`<root>/Database/events-YYYY.jsonl`, one JSON object per line:
```json
{"v":1,"op":"put","at":"2026-09-29T05:10:12+05:30","event":{...}}
{"v":1,"op":"delete","at":"…","id":"evt_…"}
{"v":1,"op":"rename","at":"…","from":["Academic","Maths"],"to":["Academic","Mathematics"]}
```
- State = replay of all files (sorted by year) line by line. Files are never rewritten.
- `commit()` writes to disk **first**, then applies in memory, so memory is never ahead of disk.
- A file without a trailing newline (crash) gets a leading `\n` on the next append.
- Bad lines (invalid JSON, invalid event, schema newer than supported, unknown op) go to `Database/quarantine.jsonl` (deduplicated) and are reported in `LoadReport`. Originals stay.
- Undo is an in-memory stack of inverse ops (max 50), cleared on bulk import.
- Duplicate prevention: id check, `externalId` index, and a fingerprint of (timestamp, path, duration, kind, result, notes, source). `allowDuplicate` overrides only the fingerprint check.
- `renamePath` is a single `rename` op applied to all matching events (and undoable).

### Schema versioning
Each op line carries `v`. To change the schema: bump `EVENT_SCHEMA_VERSION`, append `{ from: N, migrate }` to `MIGRATIONS` in `migrate.ts`. Records are migrated on read, never rewritten. Records with `v` above the supported version are quarantined, not dropped. Settings use the same mechanism (`SETTINGS_MIGRATIONS`, `loadSettings`).

## 5. Analytics rules (don't break these)

1. **Calendar days** = `start..min(end, today)`; future days never count. Future-dated events are excluded and counted in `excludedFuture`.
2. Day math uses date keys and UTC arithmetic. A local `Date` is used only for "today" and `rangeInstants`.
3. Keep **session averages** (÷ sessions), **active-day averages** (÷ active days) and **calendar-day averages** (÷ elapsed days) distinct.
4. `percentChange` returns `null` when previous is 0/missing; callers show "new"/"none" via `Delta.kind`.
5. Exact minutes everywhere; round only in formatters.
6. Parent totals come from `rollup` (every path prefix). Never store totals.
7. Imported ActivityWatch records are daily aggregates: excluded from peak-time-of-day.
8. Previous-period logic lives in `previousRange` (rolling = same length before; week/month/year = previous calendar unit; `align` clips to elapsed days).

## 6. Parser and matching

`parseEntry` order: split notes (` - `, `|`, `//`, `notes:`) → tags/time/date/`key:value` tokens → duration (`extractDuration`) → result (exact-case label, or lowercase if last token) → session type → `resolveTokens` for subjects.

`resolveTokens`: n-gram windows (4→1) scored by `scoreMatch` (exact 100, prefix 80–90, word-prefix 70, 1–2 typos 62/60, substring 55; parse threshold 60, min prefix 3). The anchor is the deepest candidate whose ancestors cover the other matches. Unmatched words become a *new* topic/subject (flagged with a warning, created on save). A subject name beats a session-type word (`Reading` stays a subject if one exists).

## 6b. Dashboard modes and widgets

Every section/chart is a **widget** with an id in `core/widgets.ts` (`WIDGETS`, `SIMPLE_ORDER`, `ADVANCED_ORDER`). `settings.dashboard.mode` selects the renderer; `settings.dashboard.visibility[mode][id]` stores user choices; a missing entry falls back to the widget's default for that mode, so new widgets in later versions appear correctly without migration. Widgets are rendered by `DashboardView.widget()`; the shared `w()` helper adds the title and the hide button. Some widgets have mode-specific renderers (`today`, `goals`, `breakdown`, `comparison`, `attention`); the rest render identically in both modes.

Settings schema v2 introduced this (v1 had on/off `sections`): `SETTINGS_MIGRATIONS` maps old flags to widget visibility and keeps existing users on the advanced view. This is the first real use of the migration chain and is covered by tests.

Colours: `colorFor` returns a palette name; the UI maps it to Obsidian's `--color-*` variables. Categories take palette slots in tree order, subjects the following slots, deeper nodes inherit; `SubjectNode.color` overrides.

## 7. Adding things

- **A metric:** add an entry to `METRICS` in `core/metrics.ts` (`id`, `label`, `definition`, `format`). It appears in settings and on the dashboard. Add a test where the math lives (`stats.ts`).
- **A range preset:** extend `RangeId` (types), `resolveRange` + `RANGE_LABELS` (dates), then add to `RANGE_CHOICES` in `ui/dashboard.ts`.
- **A dashboard widget:** add an entry to `WIDGETS` (+ the order arrays), a `wYourWidget` method in `dashboard.ts`, and a case in `DashboardView.widget()`. Visibility controls in Customize and Settings appear automatically.
- **A chart:** add a function in `ui/charts.ts` (keep SVG with `role="img"`, `aria-label`, `<title>` and keyboard focus for interactive parts) and call it from `dashboard.ts`.
- **A setting:** add to `TrackerSettings` + `createDefaultSettings` (`deepMerge` fills missing keys for existing users), then a control in `settingsTab.ts`. Multi-line text fields get a pure parser in `settingsText.ts` with tests.
- **An import format:** produce raw objects and pass them to `EventStore.addMany` (it validates, de-duplicates, never overwrites).

## 8. Testing

`tests/*.test.ts` run on Node's built-in runner through `tsx`; `tests/helpers.ts` has an in-memory `StorageIO` and event factories. Coverage: duration formats, ranges (week/month/year, leap years, month/year boundaries), time zones (`process.env.TZ` switching incl. DST days), aggregation, percent change, median, active days, gaps, streaks, targets, neglect, recall/SRS, performance index, aliases/fuzzy/typos, parser examples, store persistence, duplicates, corruption recovery, migrations, undo, rename, JSON/CSV round trips, backups, ActivityWatch aggregation, settings parsing, a 50k-event performance check.

Not covered: anything touching the DOM or Obsidian. Suggested next step: a jsdom/Playwright harness for `dashboard.ts`, `trackModal.ts`, `settingsTab.ts` with a runtime Obsidian shim.

## 9. Conventions

- Core stays free of Obsidian and DOM imports. Inject I/O (`StorageIO`, `HttpFn`).
- Use `import type` for types (`isolatedModules`).
- Don't add runtime dependencies; prefer small, testable algorithms.
- Never rewrite or delete user data silently: quarantine, report, or ask.
- Don't register default hotkeys (Obsidian guideline); users bind commands themselves.
- Use Obsidian CSS variables so themes and accent colours work.

## 10. Known issues and roadmap

**Verify/fix on first real run:** modal and dashboard layout, `DataAdapter.append` behaviour on mobile, `requestUrl` behaviour for ActivityWatch, datalist autocomplete in the detailed form, focus handling after dashboard re-render.

**Gaps:** no dedicated task-completion view; `Subjects/` is empty; backup restore is merge-only (can't restore deletions); undo is session-only.

**Highest-value next work**
1. Per-device log files (`events-YYYY-<device>.jsonl`) merged on load, to remove two-device sync conflicts.
2. Start/stop session command (records elapsed time).
3. Calendar heatmap and weekday×hour heatmap.
4. Required-pace forecasts toward targets.
5. Grade-trend charts per subject.
6. A data-health command (outliers, duplicates, orphaned subjects, dead targets).
7. Persistent revert/history view built from the log.
8. Daily-note integration; subject merge/move; Toggl/Clockify/ICS importers.
9. Real UI test harness.

## 11. Release checklist

1. `npm test && npm run build` pass.
2. Bump `version` in `manifest.json`, `package.json`, and add `"<version>": "<minAppVersion>"` to `versions.json`.
3. Tag the release and attach `main.js`, `manifest.json`, `styles.css`.

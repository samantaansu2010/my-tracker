# My Tracker — user guide

**You log what you did. My Tracker does the mathematics.**
Totals, averages, comparisons, trends, targets and charts are calculated for you from the raw entries. You never add up hours by hand.

Everything stays in your vault. There is no account, no cloud service, no telemetry and no AI. (The only possible network call is to *your own* ActivityWatch app on this computer, and only if you switch that feature on.)

---

## 1. Install

1. Download the plugin files `main.js`, `manifest.json`, `styles.css`.
2. Put them in `<your vault>/.obsidian/plugins/my-tracker/`.
3. In Obsidian: **Settings → Community plugins → turn on My Tracker**.

## 2. First run

A setup window opens.

- **Tracking folder** – default `Tracking`. You can rename it or use a path like `Life/Tracking`.
- **Start with example subjects** – Mathematics, English, Physical Science, Programming, Computer. Everything is editable later.

It creates this structure and touches no other files in your vault:

```
Tracking/
├── Database/    your events (do not edit by hand)
├── Subjects/
├── Templates/   examples for embedding stats in notes
├── Dashboard/
├── Reports/     generated report notes
└── Backups/     automatic backups and exports
```

## 3. Logging an activity (the 5-second way)

Open the Command Palette and run **My Tracker: Track Activity**. (Tip: Settings → Hotkeys → search "Track Activity" and give it a shortcut.)

Type one line and press **Enter**:

| You type | Saved as |
|---|---|
| `Math Algebra 45m A` | Academic › Mathematics › Algebra · 45 min · result A |
| `Physical Science 1h 20m` | Academic › Physical Science · 80 min |
| `English 30 min B` | Academic › English · 30 min · result B |
| `Programming JavaScript 2h A` | Technology › Programming › JavaScript · 120 min · A |

A live preview under the box shows exactly what will be saved. Parts that don't exist yet are marked **new** and are created when you save.

### What you can type
- **Duration:** `20m`, `20 min`, `20 minutes`, `1h`, `1 hour`, `1h 30m`, `1h30m`, `1.5h`, `90m`, `01:30`, `1:30`. A bare number (`Math 45`) uses your default unit (minutes unless you change it).
- **Subject:** any name, alias, partial name or slightly misspelled name. `MATH`, `Maths`, `Mathamatics` all become **Mathematics**. `JS` becomes **JavaScript**. Multi-word names work (`Physical Science`, `quadratic equations`).
- **Result:** a grade from your scale (default A–D), e.g. `A`.
- **Tags:** `#exam-preparation`
- **Time/date:** `@14:30`, `@9pm`, `yesterday`, `2026-09-01`. Default is right now.
- **Type of session:** `kind:recall` (or just the word `recall`): Study, Recall, Revision, Practice, Test, Reading, Research, Writing.
- **Planned time:** `planned:1h` (powers "planned vs actual").
- **Measurements:** `recall:8/10`, `accuracy:85%`.
- **Notes:** everything after ` - ` or `notes:`, e.g. `Math Algebra 45m A - practiced 12 problems`.

### Keyboard
- **Tab** accepts the top suggestion, **↑/↓** moves through suggestions.
- **Enter** saves. **Shift+Enter** saves and keeps the window open for the next entry.
- **Ctrl/Cmd+Enter** saves from anywhere in the window.
- Open **Detailed form** for dropdowns and fields (category, subject, subsubject, topic, duration, result, type, date & time, planned, tags, measurements, notes).

### Mistakes
- Saving the exact same event twice is blocked ("Save anyway" overrides).
- After saving, the pop-up has an **Undo** button. **My Tracker: Undo last change** also works (this session only).
- Click any number on the dashboard to see the underlying events, then **Edit** or **Delete** them.

---

## 4. Two views: Simple and Advanced

Switch any time with the **Simple | Advanced** control at the top of the dashboard (or in Settings → Dashboard). Same data, different amount of detail. Your first-run choice is the starting point.

### Simple view — calm and friendly
- **Today:** one big number, the subjects you worked on (in colour), your streak 🔥 and a ring showing goal progress.
- **This week:** seven colourful day bars. Tap a day to see what you did.
- **Goals:** a progress ring per goal (e.g. Maths 3h of 10h this week).
- **Compared with before:** one friendly line, like "35% more than last week".
- **Where your time goes:** coloured bars per category; tap to expand subjects.
- **Needs attention:** gentle reminders of things you haven't done for a while.
- Pick **This week / This month / This year** with the pills under the title.

### Advanced view — everything
Recent activity cards, key numbers (consistency, averages, median, longest session/gap, streak, trend), a detailed comparison table, goals with pace and history, colour-stacked charts (activity over time, weekly, monthly), distribution, cumulative time, planned vs actual, longest sessions and gaps, peaks, results and recall. It also adds a date-range picker, a subject filter and *Like-for-like*. Click totals and chart bars to see the events behind them.

### You decide what you see
- Every section has a small **eye-off** button (appears on hover) to hide it.
- **Customize** (top right) lists every section and chart with an on/off switch, separately for each view, plus *Reset to defaults*.
- **Settings → Dashboard** has the same switches. Hidden sections are never deleted; a "N sections hidden — show" link appears at the bottom of the dashboard.
- **Colours:** each category gets its own colour automatically; change any subject's colour in Settings → Subjects.

## 5. Subjects and aliases

**Settings → My Tracker → Subjects, aliases and hierarchy**

- Nest as deep as you like: Academic › Mathematics › Algebra › Quadratic Equations › …
- Add **aliases** (Math, Maths → Mathematics; Physics → Physical Science; JS → JavaScript).
- **Rename** a subject: past events are updated automatically (undoable), and targets/rules pointing to it follow.
- **Remove** a subject from the list: its events are kept. Pick a **colour** per subject, or leave it on Auto.
- New subjects are created automatically when you type them.

## 6. How the numbers are calculated

All values are computed from your raw entries; nothing is stored as a "total".

| Metric | Meaning |
|---|---|
| Total time | Sum of event durations in the range |
| Active days | Days with at least one event, out of days elapsed so far |
| Consistency | Active days ÷ days elapsed (future days never count) |
| Avg per active day | Total ÷ active days |
| Avg per calendar day | Total ÷ days elapsed (idle days count as zero) |
| Avg / median session | Average / middle event duration |
| Longest gap | Most fully idle days between two active days |
| Streak | Consecutive active days ending now (an empty *today* doesn't break it) |
| Trend | Slope of daily time (needs ≥ 7 days and ≥ 3 active days); "flat" if the change is under 10% of an average day |
| Change % | (current − previous) ÷ previous × 100. If previous is 0 it shows **new** instead of inventing a percentage |
| Weekly / monthly average | Per-day average × 7 / × 30.44 (rates) |

Hover any metric card for its definition. **Like-for-like**: if this month is only 10 days old, last month is cut to its first 10 days for the comparison.

Example check (September 29th): 12 active days of 29 elapsed → consistency 41.4%.

Your own **result grades** (A–D or your scale) and **measurements** are shown as counts and averages. They describe your sessions; they are not an objective measure of ability. A **performance index** appears only if you opt in, and its exact formula is displayed in settings.

## 7. Targets and neglected areas

- **Targets** (Settings → Targets): e.g. Mathematics 10h/week, Reading 30m/day. The dashboard shows actual, remaining, completion %, over/under, pace and a history of past periods.
- **Neglected:** a subject is flagged when its last activity is older than its threshold (default 7 days; set per-subject). Mark subjects **Intentionally inactive** (never flagged) or **Temporarily inactive** (until a date). Subjects with no entries yet are shown as "no activity yet", not as neglected.

## 8. Ask questions, embed stats, reports

- **My Tracker: Ask a question** – e.g. "How much Mathematics did I do in the last 14 days?", "How much Mathematics > Algebra > Quadratic Equations this month?", "Compare English this month with last month".
- **Embed in any note:**
  ````
  ```my-tracker
  subject: Mathematics
  range: last 14 days
  compare: true
  chart: true
  ```
  ````
  Optional `metrics: total, sessions, consistency`.
- **My Tracker: Generate report** writes a Markdown note into `Reports/` with properties (frontmatter) you can query.

## 9. Optional: computer / app time with ActivityWatch

My Tracker can't know which apps you used, so it can read them from [ActivityWatch](https://activitywatch.net) if you run it.

1. Settings → ActivityWatch → enable, **Test connection**.
2. **Sync now** (or enable and it syncs on startup). It refreshes the last N days; repeating is safe.
3. Time appears under **Technology › Computer › <App>**, so *Computer* is automatically the total of its apps. Time when you're away from the keyboard is excluded.
4. Optional rules map apps to your subjects: `app | discord | Technology > Discord`.

Imported data are **daily totals per app**, not individual sessions. Everything else works without ActivityWatch.

## 10. Your data, safety and backups

- Data lives in `Tracking/Database/events-YYYY.jsonl`: plain text, append-only, so past entries are never rewritten.
- **Backups:** automatic (default daily, keeps 14) into `Tracking/Backups/`. **Back up now**, **Export JSON/CSV**, **Import…** are in the Command Palette and settings.
- **Import never overwrites.** Duplicates are skipped and unreadable rows are saved to an `import-rejects` file.
- If a line in the database is damaged, it is moved to `Database/quarantine.jsonl` and you're told. Nothing is silently deleted.
- Syncing the vault between devices: open it on one device at a time for now (see Known limitations).

## 11. Settings overview

Folder · default category · date/time format · week start · default duration unit · view mode and visible sections · subjects, aliases & colours · result scale · measurements · session types & recall types · performance-index weights · targets · neglect thresholds · spaced-repetition intervals · dashboard sections and metrics · moving-average window · ActivityWatch · backups · import/export.

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| Typed subject became a new subject | Add it as an alias of the right subject in settings |
| "Duration not understood" | Use `45m`, `1h 20m` or `1:30` |
| Dashboard doesn't update after editing files outside Obsidian | **My Tracker: Reload data from disk** |
| Changed the tracking folder name | Move the folder yourself, then reload Obsidian |
| ActivityWatch can't connect | Make sure it's running; default address `http://localhost:5600` |

**Known limitations:** undo lasts for the current session; the same vault open on two devices at the same time can create sync conflicts in the database file.

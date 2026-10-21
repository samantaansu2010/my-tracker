## Unreleased

- Add a Calendar workspace with Day, Week, Month, and List views.
- Separate scheduled tasks from completed activity so planned time is excluded from actual-time analytics.
- Preserve scheduled tasks in JSON backups and exports, including a status column in CSV.
- Add calendar navigation and a dashboard shortcut. This work is not released yet.

# Changelog

## 0.1.2 — 2026-10-11

- **Advanced is the one place for analytics.** The separate Analysis page and its button are gone. The `Open analysis` command opens the Advanced dashboard, and an Analysis tab restored from an earlier session redirects there.
- **New Overview section** at the top of Advanced: total time with its change against the previous period, a trend line, and sessions / active days / per-active-day / streak with their own changes. Changes appear only when there is a previous period to compare with; "new" is shown instead of an invented percentage.
- **Redesigned charts**, all with one shared hover card (also on keyboard focus) instead of the browser's slow native tooltips:
  - *Activity over time*: rounded stacked bars, Day / Week / Month switch, optional overlay of the previous period, a smoothed moving average, faint marks for empty days.
  - *Activity heatmap*: larger cells, today outlined, intensity labels, starts at the latest weeks in narrow panes.
  - *Subject comparison*: change chips and a previous-period marker per subject; click a row for its events, "›" to filter the whole dashboard to it.
  - *Time distribution*: hover a segment or legend row to focus it.
  - *Session length*: average / median / longest / shortest tiles (with the average's change), count labels, and the median's bin highlighted.
- **New insights from recorded data only**: which subjects rose or dropped most, session length against the previous period, planned versus actual time. Each appears only when both periods have enough data.
- **Brand and layout**: one purple brand colour (totals, active states, heatmap) with subject colours only where a subject is shown; the layout reacts to the pane's width rather than the window's. Light and dark themes.
- **New Customize toggles** (Advanced): Overview, Activity heatmap, Insights, Session length, Subject comparison, Time distribution. The older *Distribution* list is off by default for new installs. Existing settings and hidden sections are unchanged.
- Cleaner empty and sparse states: charts with fewer than two active periods show one line instead of an almost empty chart, and an empty previous period replaces the comparison table with one sentence.
- Fixed: the session-length y-axis showed duplicate labels; the heatmap quoted 181 days for a 6-day range; `tsconfig.json` now loads Node types so the typecheck passes with the test files included.
- Track modal and Customize window: clearer field borders, tighter spacing, readable Simple/Advanced switch.

## 0.1.0 — first public release

- Fast entry: one line such as `Math Algebra 45m A`, with aliases, typo tolerance, autocomplete and live preview.
- Local-first storage: append-only event log in your vault, stable event IDs, duplicate protection, quarantine for damaged lines, undo (per session), rolling backups, JSON/CSV export and merge-only import, schema versioning with migrations.
- Automatic analytics: hierarchical totals, consistency, averages, medians, gaps, streaks, trend, period comparisons (zero-safe), targets, neglected areas, recall and optional spaced-repetition due list, results and an optional transparent performance index.
- Two dashboard views: **Simple** (today, this week, goals, where your time goes) and **Advanced** (all metrics, charts and comparisons), with per-section show/hide for each view, colour per subject and colour-stacked charts.
- Natural-language questions, embeddable `my-tracker` code blocks, Markdown reports.
- Optional ActivityWatch integration (desktop, localhost only).

Known limitations: undo lasts for the current session; open the vault on one device at a time until per-device logs arrive; changing the tracking folder name requires moving the folder and reloading Obsidian.

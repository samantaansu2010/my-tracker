# Changelog

## 0.1.0 — first public release

- Fast entry: one line such as `Math Algebra 45m A`, with aliases, typo tolerance, autocomplete and live preview.
- Local-first storage: append-only event log in your vault, stable event IDs, duplicate protection, quarantine for damaged lines, undo (per session), rolling backups, JSON/CSV export and merge-only import, schema versioning with migrations.
- Automatic analytics: hierarchical totals, consistency, averages, medians, gaps, streaks, trend, period comparisons (zero-safe), targets, neglected areas, recall and optional spaced-repetition due list, results and an optional transparent performance index.
- Two dashboard views: **Simple** (today, this week, goals, where your time goes) and **Advanced** (all metrics, charts and comparisons), with per-section show/hide for each view, colour per subject and colour-stacked charts.
- Natural-language questions, embeddable `my-tracker` code blocks, Markdown reports.
- Optional ActivityWatch integration (desktop, localhost only).

Known limitations: undo lasts for the current session; open the vault on one device at a time until per-device logs arrive; changing the tracking folder name requires moving the folder and reloading Obsidian.

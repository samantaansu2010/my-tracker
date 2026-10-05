import type { MarkdownPostProcessorContext } from "obsidian";
import type { TrackerHost } from "../host";
import { parseQuestion } from "../core/queryText";
import { resolveRange, previousRange, formatShortDate } from "../core/dates";
import { computeStats, bucketSeries, filterByPath } from "../core/stats";
import { compareStats } from "../core/compare";
import { metricById } from "../core/metrics";
import { formatDuration, formatPercentChange, formatSignedDuration } from "../core/duration";
import { pathLabel } from "../core/hierarchy";
import { barChart } from "./charts";

/** ```my-tracker  subject: Mathematics / range: last 14 days / compare: true / metrics: total, sessions / chart: true */
export function renderCodeBlock(host: TrackerHost, source: string, el: HTMLElement, _ctx: MarkdownPostProcessorContext): void {
  const cfg: Record<string, string> = {};
  for (const line of source.split("\n")) { const m = /^\s*([a-z]+)\s*:\s*(.*)$/i.exec(line); if (m) cfg[m[1].toLowerCase()] = m[2].trim(); }
  const box = el.createDiv({ cls: "mt-embed" });
  if (!host.store.size && !host.settings.setupComplete) { box.createDiv({ cls: "mt-empty", text: "My Tracker isn't set up yet." }); return; }
  const s = host.settings, today = host.today();
  const q = parseQuestion(`${cfg.subject ?? cfg.path ?? ""} ${cfg.range ?? "last 30 days"}`, s.tree);
  const range = resolveRange(q.range, today, host.resolveOpts());
  const events = filterByPath(host.store.list(), q.path);
  const st = computeStats(events, range, today);
  box.createEl("h4", { text: `${q.path.length ? pathLabel(q.path) : "All activity"} · ${range.label}` });
  const ids = cfg.metrics ? cfg.metrics.split(/[,\s]+/).filter(Boolean) : ["total", "sessions", "activeDays", "consistency", "avgPerActiveDay"];
  const grid = box.createDiv({ cls: "mt-grid-cards" });
  for (const id of ids) { const m = metricById(id); if (!m) continue; const c = grid.createDiv({ cls: "mt-stat", attr: { title: m.definition } }); c.createDiv({ cls: "mt-stat-label", text: m.label }); c.createDiv({ cls: "mt-stat-value", text: m.format(st) }); }
  if (/^(true|yes|1)$/i.test(cfg.compare ?? "")) {
    const prev = previousRange(range, today, true);
    const c = compareStats(st, computeStats(events, prev, today));
    box.createDiv({ cls: "mt-muted", text: `vs ${prev.label}: ${formatDuration(c.minutes.previous)} → ${formatDuration(c.minutes.current)} (${formatSignedDuration(c.minutes.diff ?? 0)}${c.minutes.kind === "pct" ? ", " + formatPercentChange(c.minutes.pct) : c.minutes.kind === "new" ? ", new activity" : ""})` });
  }
  if (/^(true|yes|1)$/i.test(cfg.chart ?? "") && st.calendarDays) {
    const b = bucketSeries(events, range.start, st.end, st.calendarDays <= 62 ? "day" : "week", s.weekStartsOn);
    barChart(box, { items: b.map((x) => ({ label: formatShortDate(x.start, s.dateFormat), value: x.minutes, key: x.key, title: `${x.start}: ${formatDuration(x.minutes)}` })), aria: "Activity chart", height: 110 });
  }
}

import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { TrackerHost } from "../host";
import type { TrackerEvent } from "../core/types";
import type { DateRange } from "../core/dates";
import { formatDateKey } from "../core/dates";
import { formatDuration, formatPercent } from "../core/duration";
import { MIN_DATA, buildAnalysis, heatmapCaption, subjectChanges, type AnalysisModel, type Insight } from "../core/analysis";
import { colorFor } from "../core/colors";
import { pathKey, pathLabel } from "../core/hierarchy";
import { donutChart, heatmapChart, histogramChart, subjectBars } from "./analysisCharts";

export const ANALYSIS_VIEW_TYPE = "my-tracker-analysis";
const cssColor = (name: string) => `var(--color-${name}, var(--interactive-accent))`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What the dashboard has to provide so these sections can live inside its widget frames. */
export interface SectionHooks {
  /** Creates a dashboard widget (title, hide button) and returns its body. */
  widget(board: HTMLElement, id: string, title: string, o?: { wide?: boolean; sub?: string }): HTMLElement;
  /** A subject was chosen: the whole page filters to it. */
  setScope(path: string[]): void;
  /** Re-draw the page after a local toggle (e.g. "show more insights"). */
  rerender(): void;
}

export interface SectionInput { all: TrackerEvent[]; today: string; range: DateRange; prev: DateRange; scope: string[] }

/**
 * The analysis sections (heatmap, session length, insights, subject comparison, time distribution) as dashboard widgets.
 * Every number comes from buildAnalysis() → the existing engine over the raw events; this class only draws.
 */
export class AnalysisSections {
  static readonly IDS = ["insights", "heatmap", "sessionLength", "subjectCompare", "composition"] as const;
  private static readonly INSIGHTS_SHOWN = 3;
  private showAllInsights = false;
  private prevLabel = "Previous period";
  private today = "";

  constructor(private host: TrackerHost, private hooks: SectionHooks) {}

  private fmtDate = (d: string): string => formatDateKey(d, this.host.settings.dateFormat);
  private color(path: string[]): string { return cssColor(colorFor(path, this.host.settings.tree)); }
  private drill(m: AnalysisModel, title: string, start: string, end: string, pred?: (e: TrackerEvent) => boolean): void {
    this.host.openDrill(title, () => this.host.store.list().filter((e) => m.filter(e) && e.date >= start && e.date <= end && (!pred || pred(e))));
  }

  build(i: SectionInput): AnalysisModel {
    this.prevLabel = i.prev.label; this.today = i.today;
    return buildAnalysis({
      events: i.all, scope: i.scope, range: i.range, prev: i.prev, today: i.today, weekStartsOn: this.host.settings.weekStartsOn,
      includeActivityWatch: true, fmtDate: this.fmtDate,
    });
  }

  render(id: string, board: HTMLElement, m: AnalysisModel, scope: string[]): void {
    // With nothing in the range only the heatmap can still help (earlier activity gives context); the rest stay out of the way.
    if (!m.hasData && !(id === "heatmap" && m.heatmap.summary.activeDays > 0)) return;
    switch (id) {
      case "insights": return this.insights(board, m);
      case "heatmap": return this.heat(board, m);
      case "sessionLength": return this.sessions(board, m);
      case "subjectCompare": return this.subjects(board, m, scope);
      case "composition": return this.composition(board, m, scope);
    }
  }

  private insights(board: HTMLElement, m: AnalysisModel): void {
    if (!m.insights.length) return;                       // no fabricated findings: the widget simply waits for enough data
    const body = this.hooks.widget(board, "insights", "Insights");
    const more = m.insights.length > AnalysisSections.INSIGHTS_SHOWN;
    const list = body.createDiv({ cls: "mt-an-insights" });
    for (const i of this.showAllInsights || !more ? m.insights : m.insights.slice(0, AnalysisSections.INSIGHTS_SHOWN)) this.insight(list, m, i);
    if (more) body.createEl("button", { cls: "mt-linkbtn mt-an-more", text: this.showAllInsights ? "Show fewer" : `Show ${m.insights.length - AnalysisSections.INSIGHTS_SHOWN} more` })
      .addEventListener("click", () => { this.showAllInsights = !this.showAllInsights; this.hooks.rerender(); });
  }
  private insight(list: HTMLElement, m: AnalysisModel, i: Insight): void {
    const row = list.createDiv({ cls: "mt-an-insight" + (i.tone ? ` is-${i.tone}` : "") });
    row.createSpan({ cls: "mt-an-insight-mark", text: i.tone === "up" ? "▲" : i.tone === "down" ? "▼" : "•", attr: { "aria-hidden": "true" } });
    row.createSpan({ cls: "mt-an-insight-text", text: i.text });
    if (i.drill) { const d = i.drill; const b = row.createEl("button", { cls: "mt-linkbtn mt-an-events", text: "events", attr: { "aria-label": `Show events: ${d.title}` } }); b.addEventListener("click", () => this.drill(m, d.title, d.start, d.end, (e) => d.path.every((p, k) => e.path[k] === p))); }
  }

  private heat(board: HTMLElement, m: AnalysisModel): void {
    const h = m.heatmap;
    const body = this.hooks.widget(board, "heatmap", "Activity heatmap", { sub: heatmapCaption(h) });
    heatmapChart(body, h, {
      monthLabel: (key) => { const [y, mo] = key.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "short" }); },
      weekdayLabel: (wd) => new Date(2023, 0, 1 + wd).toLocaleDateString(undefined, { weekday: "short" }),
      fmtDate: this.fmtDate, today: this.today,
      onSelect: (date) => this.drill(m, this.fmtDate(date), date, date),
    });
  }

  private subjects(board: HTMLElement, m: AnalysisModel, scope: string[]): void {
    const body = this.hooks.widget(board, "subjectCompare", "Subject comparison", { wide: false, sub: scope.length ? `Within ${scope[scope.length - 1]}` : "By subject" });
    const changes = new Map(subjectChanges(m.subjects, m.previousSubjects).map((c) => [pathKey(c.path), c]));
    subjectBars(body, m.subjects, {
      colorOf: (g) => this.color(g.path), fmtPct: (n) => formatPercent(n, 0),
      changeOf: m.prevStats.totalMinutes > 0 ? (g) => changes.get(pathKey(g.path)) : undefined, prevLabel: this.prevLabel,
      onEvents: (g) => this.drill(m, pathLabel(g.path), m.stats.start, m.stats.end, (e) => (g.name === "(direct)" ? e.path.length === g.path.length : true) && g.path.every((p, k) => e.path[k] === p)),
      canDrill: (g) => g.name !== "(direct)" && m.events.some((e) => e.path.length > g.path.length && g.path.every((p, k) => e.path[k] === p)),
      onDrill: (g) => this.hooks.setScope(g.path),
    });
  }

  private composition(board: HTMLElement, m: AnalysisModel, scope: string[]): void {
    const body = this.hooks.widget(board, "composition", "Time distribution", { wide: false, sub: scope.length ? `Within ${scope[scope.length - 1]}` : "By category" });
    const c = m.composition;
    if (c.donut) {
      donutChart(body, c.slices, {
        colorOf: (s) => (s.path.length ? this.color(s.path) : "var(--text-faint)"), total: m.stats.totalMinutes, fmtPct: (n) => formatPercent(n, 0),
        onSelect: (s) => this.drill(m, pathLabel(s.path), m.stats.start, m.stats.end, (e) => (s.name === "(direct)" ? e.path.length === s.path.length : true) && s.path.every((p, k) => e.path[k] === p)),
      });
    } else body.createDiv({ cls: "mt-empty", text: c.reason ?? "Not enough data for a composition chart." });
  }

  private sessions(board: HTMLElement, m: AnalysisModel): void {
    const ss = m.sessions;
    const body = this.hooks.widget(board, "sessionLength", "Session length", { sub: ss.excludedDailyTotals ? `excludes ${plural(ss.excludedDailyTotals, "ActivityWatch daily total")}` : undefined });
    if (!ss.count) { body.createDiv({ cls: "mt-empty", text: "No sessions in this range." }); return; }
    const line = body.createDiv({ cls: "mt-an-stats" });
    const item = (label: string, value: string, o: { onClick?: () => void; sub?: string } = {}) => {
      const el = line.createDiv({ cls: "mt-an-stat" }); el.createDiv({ cls: "mt-an-stat-label", text: label });
      if (o.onClick) el.createEl("button", { cls: "mt-linkbtn mt-an-stat-value", text: value }).addEventListener("click", o.onClick); else el.createDiv({ cls: "mt-an-stat-value", text: value });
      if (o.sub) el.createDiv({ cls: "mt-an-stat-sub", text: o.sub });
    };
    const pv = m.previousSessions;
    let avgSub: string | undefined;
    if (ss.count >= MIN_DATA.sessions && pv.count >= MIN_DATA.sessions && ss.averageMinutes !== null && pv.averageMinutes !== null) {
      const d = Math.round(ss.averageMinutes - pv.averageMinutes);
      avgSub = d === 0 ? "same as previous" : `${d > 0 ? "▲" : "▼"} ${formatDuration(Math.abs(d))} vs previous`;
    }
    item("Average", formatDuration(ss.averageMinutes), { sub: avgSub }); item("Median", formatDuration(ss.medianMinutes));
    item("Longest", formatDuration(ss.longest?.durationMinutes), { onClick: ss.longest ? () => this.drill(m, this.fmtDate(ss.longest!.date), ss.longest!.date, ss.longest!.date) : undefined, sub: ss.longest ? this.fmtDate(ss.longest.date) : undefined });
    item("Shortest", formatDuration(ss.shortest?.durationMinutes), { sub: ss.shortest ? this.fmtDate(ss.shortest.date) : undefined });
    histogramChart(body, ss.histogram, { highlightMinutes: ss.medianMinutes, onSelect: (b) => this.drill(m, `Sessions ${b.label}`, m.stats.start, m.stats.end, (e) => e.source !== "activitywatch" && e.durationMinutes >= b.min && e.durationMinutes < b.max) });
  }
}

/**
 * Analysis now lives inside the Advanced dashboard. This view type stays registered only so a tab restored from an
 * earlier session (or a saved layout) does not fail: it opens the dashboard in Advanced mode and closes itself.
 */
export class AnalysisView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private host: TrackerHost) { super(leaf); }
  getViewType(): string { return ANALYSIS_VIEW_TYPE; }
  getDisplayText(): string { return "My Tracker"; }
  getIcon(): string { return "bar-chart-3"; }
  async onOpen(): Promise<void> {
    this.contentEl.createDiv({ cls: "mt-muted", text: "Analysis moved into the Advanced dashboard — opening it…" });
    this.app.workspace.onLayoutReady(() => { void this.host.openAnalysis().then(() => this.leaf.detach()); });
  }
}

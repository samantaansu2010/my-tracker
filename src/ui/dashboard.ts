import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { TrackerHost } from "../host";
import type { RangeId, RangeSpec, TrackerEvent } from "../core/types";
import { RANGE_LABELS, addDays, formatDateKey, formatMonthLabel, formatShortDate, previousRange, resolveRange, shiftMonthStart, startOfWeek, type DateRange } from "../core/dates";
import { formatDuration, formatPercent, formatPercentChange, formatSignedDuration } from "../core/duration";
import { bucketSeries, bucketStartOf, computeStats, cumulative, dailySeries, distribution, filterByPath, filterByRange, movingAverage, rollup, sum, topGaps, topSessions, type Bucket, type Granularity } from "../core/stats";
import { compareStats, delta, type Delta } from "../core/compare";
import { metricById } from "../core/metrics";
import { flatten, pathKey, pathLabel, SEP } from "../core/hierarchy";
import { targetHistory, targetStatus } from "../core/targets";
import { evaluateNeglect } from "../core/neglect";
import { recallStats, spacedRepetition, isRecall } from "../core/recall";
import { describeIndexFormula, measurementStats, performanceIndex, resultStats } from "../core/performance";
import { colorFor } from "../core/colors";
import { ADVANCED_ORDER, SIMPLE_ORDER, hiddenByUser, isVisible, type ViewMode } from "../core/widgets";
import { barChart, hBars, legend, lineChart, progressBar, ring, type BarItem } from "./charts";
import { LayoutModal } from "./layoutEditor";

export const VIEW_TYPE = "my-tracker-dashboard";
const RANGE_CHOICES: RangeId[] = ["today", "yesterday", "last7", "last14", "last30", "last90", "thisWeek", "prevWeek", "thisMonth", "prevMonth", "thisYear", "prevYear", "sinceJan1", "sinceInstall", "custom"];
const SIMPLE_RANGES: { id: RangeId; label: string }[] = [{ id: "thisWeek", label: "This week" }, { id: "thisMonth", label: "This month" }, { id: "thisYear", label: "This year" }];
const cssColor = (name: string) => `var(--color-${name}, var(--interactive-accent))`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

interface Ctx {
  all: TrackerEvent[]; events: TrackerEvent[]; today: string; streak: number;
  range: DateRange; prev: DateRange; rangeEvents: TrackerEvent[]; prevEvents: TrackerEvent[];
  stats: ReturnType<typeof computeStats>; prevStats: ReturnType<typeof computeStats>;
}

export class DashboardView extends ItemView {
  private scopeIds: string[] = [];
  private spec: RangeSpec;
  private simpleRange: RangeId = "thisWeek";
  private align = true;
  private lastToday = "";
  private timer: number | null = null;

  constructor(leaf: WorkspaceLeaf, private host: TrackerHost) {
    super(leaf);
    this.spec = { id: host.settings.dashboard.defaultRange };
  }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "My Tracker"; }
  getIcon(): string { return "bar-chart-3"; }
  async onOpen(): Promise<void> {
    this.contentEl.addClass("mt-dashboard");
    this.render();
    this.timer = window.setInterval(() => { if (this.host.today() !== this.lastToday) this.render(); }, 60_000);
  }
  async onClose(): Promise<void> { if (this.timer !== null) window.clearInterval(this.timer); }
  refresh(): void { this.render(); }

  // ---------- helpers ----------
  private get mode(): ViewMode { return this.host.settings.dashboard.mode; }
  private get simple(): boolean { return this.mode === "simple"; }
  /** Subject filter. The simple view never filters. */
  private get sc(): string[] { return this.simple ? [] : this.scopeIds; }
  private color(path: string[]): string { return cssColor(colorFor(path, this.host.settings.tree)); }
  private fmtDate(d: string): string { return formatDateKey(d, this.host.settings.dateFormat); }
  private inScope = (e: TrackerEvent): boolean => this.sc.every((s, i) => e.path[i] === s);
  private drill(title: string, filter: (e: TrackerEvent) => boolean): void { this.host.openDrill(title, () => this.host.store.list().filter(filter)); }
  private drillPath(path: string[], start: string, end: string, label?: string): void {
    this.drill(label ?? `${pathLabel(path)} · ${start === end ? this.fmtDate(start) : `${this.fmtDate(start)} → ${this.fmtDate(end)}`}`, (e) => e.date >= start && e.date <= end && path.every((s, i) => e.path[i] === s));
  }
  private deltaText(d: Delta): { text: string; cls: string } {
    if (d.kind === "pct") return { text: formatPercentChange(d.pct), cls: d.diff! > 0 ? "mt-up" : d.diff! < 0 ? "mt-down" : "" };
    if (d.kind === "new") return { text: "new", cls: "mt-up" };
    return { text: "–", cls: "" };
  }
  private renderIcon(parent: HTMLElement, name: string): HTMLElement { const s = parent.createSpan({ cls: "mt-icon" }); setIcon(s, name); return s; }
  private async setMode(m: ViewMode): Promise<void> { this.host.settings.dashboard.mode = m; await this.host.saveSettings(); }

  /** Widget container with a title and a "hide" button. Returns the body element. */
  private w(board: HTMLElement, id: string, title: string, o: { wide?: boolean; sub?: string } = {}): HTMLElement {
    const box = board.createDiv({ cls: "mt-widget" + (o.wide === false ? "" : " mt-wide"), attr: { "data-widget": id } });
    const head = box.createDiv({ cls: "mt-whead" });
    if (title) head.createEl("h3", { text: title }); else head.addClass("mt-whead-float");
    if (o.sub) head.createSpan({ cls: "mt-wsub", text: o.sub });
    const hide = head.createEl("button", { cls: "clickable-icon mt-hide", attr: { "aria-label": `Hide “${title || id}”`, title: "Hide this section — bring it back from Customize or Settings" } });
    setIcon(hide, "eye-off");
    hide.addEventListener("click", async () => { this.host.settings.dashboard.visibility[this.mode][id] = false; await this.host.saveSettings(); });
    return box.createDiv({ cls: "mt-wbody" });
  }
  private card(parent: HTMLElement, label: string, value: string, sub?: string, title?: string): HTMLElement {
    const c = parent.createDiv({ cls: "mt-stat" });
    if (title) c.setAttribute("title", title);
    c.createDiv({ cls: "mt-stat-label", text: label });
    c.createDiv({ cls: "mt-stat-value", text: value });
    if (sub) c.createDiv({ cls: "mt-stat-sub", text: sub });
    return c;
  }
  private chip(parent: HTMLElement, text: string, color?: string): HTMLElement {
    const c = parent.createSpan({ cls: "mt-chip", text });
    if (color) c.setAttribute("style", `--c:${color}`), c.addClass("is-colored");
    return c;
  }

  // ---------- build & render ----------
  private build(): Ctx {
    const h = this.host, today = h.today(), opts = h.resolveOpts();
    const all = h.store.list();
    const events = filterByPath(all, this.sc);
    const range = resolveRange(this.simple ? { id: this.simpleRange } : this.spec, today, opts);
    const prev = previousRange(range, today, this.align || this.simple);
    const cut = (r: { start: string; end: string }) => filterByRange(events, r.start, r.end > today ? today : r.end);
    return {
      all, events, today, range, prev, rangeEvents: cut(range), prevEvents: cut(prev),
      stats: computeStats(events, range, today), prevStats: computeStats(events, prev, today),
      streak: computeStats(events, { start: addDays(today, -730), end: today }, today).currentStreak,
    };
  }

  private render(): void {
    const top = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.toggleClass("is-simple", this.simple);
    this.contentEl.toggleClass("is-advanced", !this.simple);
    const c = this.build();
    this.lastToday = c.today;
    this.header(c);
    if (!this.host.store.size) this.onboard();
    const board = this.contentEl.createDiv({ cls: "mt-board" });
    for (const id of this.simple ? SIMPLE_ORDER : ADVANCED_ORDER) if (isVisible(this.host.settings.dashboard.visibility, this.mode, id)) this.widget(board, id, c);
    this.footer();
    this.contentEl.scrollTop = top;
  }

  private widget(board: HTMLElement, id: string, c: Ctx): void {
    const map: Record<string, () => void> = {
      today: () => this.wToday(board, c), week: () => this.wWeek(board, c), goals: () => this.wGoals(board, c), breakdown: () => this.wBreakdown(board, c),
      comparison: () => this.wComparison(board, c), attention: () => this.wAttention(board, c), recent: () => this.wRecent(board, c),
      keyNumbers: () => this.wKeyNumbers(board, c), chartActivity: () => this.wChartActivity(board, c), chartWeekly: () => this.wChartBuckets(board, c, "weekly"),
      chartMonthly: () => this.wChartBuckets(board, c, "monthly"), chartDistribution: () => this.wDistribution(board, c), chartCumulative: () => this.wCumulative(board, c),
      chartPlanned: () => this.wPlanned(board, c), longestSessions: () => this.wLongestSessions(board, c), longestGaps: () => this.wLongestGaps(board, c),
      peaks: () => this.wPeaks(board, c), results: () => this.wResults(board, c), recall: () => this.wRecall(board, c),
    };
    map[id]?.();
  }

  private header(c: Ctx): void {
    const bar = this.contentEl.createDiv({ cls: "mt-header" });
    const row = bar.createDiv({ cls: "mt-header-row" });
    row.createEl("h2", { text: "My Tracker" });
    const seg = row.createDiv({ cls: "mt-seg", attr: { role: "group", "aria-label": "View mode" } });
    for (const [m, label, icon] of [["simple", "Simple", "leaf"], ["advanced", "Advanced", "bar-chart-3"]] as [ViewMode, string, string][]) {
      const b = seg.createEl("button", { cls: "mt-seg-btn" + (m === this.mode ? " is-active" : ""), attr: { "aria-pressed": String(m === this.mode) } });
      this.renderIcon(b, icon); b.createSpan({ text: label });
      b.addEventListener("click", () => { if (m !== this.mode) void this.setMode(m); });
    }
    const custom = row.createEl("button", { cls: "mt-ghost", attr: { "aria-label": "Customize dashboard" } });
    this.renderIcon(custom, "sliders-horizontal"); custom.createSpan({ text: "Customize" });
    custom.addEventListener("click", () => new LayoutModal(this.host, this.mode).open());
    const add = row.createEl("button", { cls: "mod-cta mt-add", attr: { "aria-label": "Track activity" } });
    this.renderIcon(add, "plus"); add.createSpan({ text: "Track" });
    add.addEventListener("click", () => this.host.openTrack());

    if (this.simple) {
      const pills = bar.createDiv({ cls: "mt-pills", attr: { role: "group", "aria-label": "Period" } });
      for (const r of SIMPLE_RANGES) {
        const p = pills.createEl("button", { cls: "mt-pill" + (r.id === this.simpleRange ? " is-active" : ""), text: r.label, attr: { "aria-pressed": String(r.id === this.simpleRange) } });
        p.addEventListener("click", () => { this.simpleRange = r.id; this.render(); });
      }
      return;
    }
    const controls = bar.createDiv({ cls: "mt-controls" });
    const range = controls.createEl("select", { attr: { "aria-label": "Date range" } });
    for (const id of RANGE_CHOICES) range.createEl("option", { text: RANGE_LABELS[id], attr: { value: id } });
    range.value = this.spec.id === "lastN" ? "last30" : this.spec.id;
    range.addEventListener("change", () => { this.spec = { id: range.value as RangeId, custom: this.spec.custom ?? { start: addDays(c.today, -29), end: c.today } }; this.render(); });
    if (this.spec.id === "custom") {
      const s = controls.createEl("input", { attr: { type: "date", "aria-label": "Start date", value: this.spec.custom!.start } });
      const e = controls.createEl("input", { attr: { type: "date", "aria-label": "End date", value: this.spec.custom!.end } });
      const upd = () => { if (s.value && e.value) { this.spec = { id: "custom", custom: { start: s.value, end: e.value } }; this.render(); } };
      s.addEventListener("change", upd); e.addEventListener("change", upd);
    }
    const scope = controls.createEl("select", { attr: { "aria-label": "Subject filter" } });
    scope.createEl("option", { text: "All activity", attr: { value: "" } });
    for (const f of flatten(this.host.settings.tree)) scope.createEl("option", { text: `${"\u00a0\u00a0".repeat(f.path.length - 1)}${f.node.name}`, attr: { value: pathKey(f.path) } });
    const known = new Set([...scope.options].map((o) => o.value));
    for (const e of c.all) for (let i = 1; i <= e.path.length; i++) { const k = pathKey(e.path.slice(0, i)); if (!known.has(k)) { known.add(k); scope.createEl("option", { text: k.split(SEP).join(" › "), attr: { value: k } }); } }
    if (this.scopeIds.length && !known.has(pathKey(this.scopeIds))) scope.createEl("option", { text: this.scopeIds.join(" › "), attr: { value: pathKey(this.scopeIds) } });
    scope.value = pathKey(this.scopeIds);
    scope.addEventListener("change", () => { this.scopeIds = scope.value ? scope.value.split(SEP) : []; this.render(); });
    const lab = controls.createEl("label", { cls: "mt-check", attr: { title: "When the current period is unfinished, compare it with the same number of days of the previous period" } });
    const cb = lab.createEl("input", { attr: { type: "checkbox" } }); cb.checked = this.align;
    lab.createSpan({ text: "Like-for-like" });
    cb.addEventListener("change", () => { this.align = cb.checked; this.render(); });
    controls.createDiv({ cls: "mt-muted mt-rangeinfo", text: `${this.fmtDate(c.range.start)} → ${this.fmtDate(c.range.end)}` });
  }

  private onboard(): void {
    const e = this.contentEl.createDiv({ cls: "mt-onboard" });
    e.createEl("h3", { text: "Let’s track your first activity" });
    e.createEl("p", { cls: "mt-muted", text: "Try typing: Math Algebra 45m A" });
    e.createEl("button", { text: "Track something", cls: "mod-cta" }).addEventListener("click", () => this.host.openTrack());
  }

  private footer(): void {
    const hidden = hiddenByUser(this.host.settings.dashboard.visibility, this.mode);
    if (!hidden.length) return;
    const f = this.contentEl.createDiv({ cls: "mt-footer" });
    const b = f.createEl("button", { cls: "mt-ghost", text: `${plural(hidden.length, "section")} hidden — show` });
    b.addEventListener("click", () => new LayoutModal(this.host, this.mode).open());
  }

  // ---------- overview widgets ----------
  private goalFraction(c: Ctx): number | null {
    const s = this.host.settings;
    const ts = s.targets.map((t) => targetStatus(t, c.all, c.today, s.weekStartsOn));
    return ts.length ? sum(ts.map((t) => Math.min(1, t.completion ?? 0))) / ts.length : null;
  }

  private wToday(board: HTMLElement, c: Ctx): void {
    const todays = c.events.filter((e) => e.date === c.today);
    const total = sum(todays.map((e) => e.durationMinutes));
    const goal = this.goalFraction(c);
    const subjects = [...new Map(todays.map((e) => [pathKey(e.path.slice(0, 2)), e.path.slice(0, 2)])).values()];
    if (this.simple) {
      const body = this.w(board, "today", "");
      body.parentElement?.addClass("mt-hero-box");
      body.addClass("mt-hero");
      const left = body.createDiv({ cls: "mt-hero-text" });
      left.createDiv({ cls: "mt-eyebrow", text: "Today" });
      left.createDiv({ cls: "mt-hero-big", text: formatDuration(total) });
      left.createDiv({ cls: "mt-hero-sub", text: todays.length ? plural(todays.length, "session") : "Nothing yet — add your first one" });
      const chips = left.createDiv({ cls: "mt-chips" });
      for (const p of subjects.slice(0, 4)) this.chip(chips, p[p.length - 1], this.color(p));
      if (c.streak > 0) { const s = chips.createSpan({ cls: "mt-chip mt-streak" }); this.renderIcon(s, "flame"); s.createSpan({ text: `${plural(c.streak, "day")} in a row` }); }
      if (goal !== null) { const r = body.createDiv({ cls: "mt-hero-ring" }); ring(r, goal, { size: 104, color: cssColor("green"), label: `Goals ${Math.round(goal * 100)}% complete`, text: `${Math.round(goal * 100)}%` }); r.createDiv({ cls: "mt-ring-cap", text: "goals" }); }
      return;
    }
    const grid = this.w(board, "today", "Today").createDiv({ cls: "mt-cards" });
    this.card(grid, "Tracked", formatDuration(total));
    this.card(grid, "Sessions", String(todays.length));
    this.card(grid, "Active subjects", String(subjects.length), subjects.map((p) => p[p.length - 1]).slice(0, 3).join(", ") || undefined);
    this.card(grid, "Streak", c.streak ? plural(c.streak, "day") : "–", "consecutive active days");
    if (goal !== null) this.card(grid, "Goals", formatPercent(goal, 0), "average completion", "Average of each target's completion for its current period, each capped at 100%");
  }

  private wWeek(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings, ws = startOfWeek(c.today, s.weekStartsOn);
    const evs = filterByRange(c.events, ws, addDays(ws, 6));
    const body = this.w(board, "week", "This week", { sub: formatDuration(sum(evs.map((e) => e.durationMinutes))) });
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const depth = this.sc.length;
    const per = days.map((d) => {
      const g = new Map<string, number>();
      for (const e of evs) if (e.date === d) g.set(e.path[depth] ?? "(direct)", (g.get(e.path[depth] ?? "(direct)") ?? 0) + e.durationMinutes);
      return { d, g, total: sum([...g.values()]) };
    });
    const max = Math.max(60, ...per.map((p) => p.total));
    const strip = body.createDiv({ cls: "mt-week" });
    for (const p of per) {
      const [y, m, dd] = p.d.split("-").map(Number);
      const label = new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: "short" });
      const col = strip.createEl("button", { cls: "mt-day" + (p.d === c.today ? " is-today" : "") + (p.d > c.today ? " is-future" : ""), attr: { "aria-label": `${label} ${this.fmtDate(p.d)}: ${formatDuration(p.total)}` } });
      const bar = col.createDiv({ cls: "mt-day-bar" });
      for (const [name, v] of p.g) { const seg = bar.createDiv({ cls: "mt-day-seg" }); seg.style.height = `${(v / max) * 100}%`; seg.style.background = this.color([...this.sc, name]); seg.setAttribute("title", `${name}: ${formatDuration(v)}`); }
      col.createDiv({ cls: "mt-day-label", text: label });
      col.createDiv({ cls: "mt-day-val", text: p.total ? formatDuration(p.total) : "" });
      col.addEventListener("click", () => this.drillPath(this.sc, p.d, p.d, `${label} · ${this.fmtDate(p.d)}`));
    }
  }

  private wGoals(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings;
    const body = this.w(board, "goals", "Goals");
    if (!s.targets.length) { body.createDiv({ cls: "mt-empty", text: "No goals yet — add one in Settings → Targets." }); return; }
    const grid = body.createDiv({ cls: this.simple ? "mt-goals" : "mt-targets" });
    for (const t of s.targets) {
      const st = targetStatus(t, c.all, c.today, s.weekStartsOn), color = this.color(t.path);
      const name = t.path[t.path.length - 1], period = t.period === "day" ? "today" : t.period === "week" ? "this week" : "this month";
      if (this.simple) {
        const g = grid.createDiv({ cls: "mt-goal" });
        ring(g, st.completion ?? 0, { size: 64, color, label: `${name} goal ${formatPercent(st.completion, 0)}`, text: st.met ? "✓" : `${Math.round((st.completion ?? 0) * 100)}%` });
        const t2 = g.createDiv({ cls: "mt-goal-text" });
        t2.createDiv({ cls: "mt-goal-name", text: name });
        t2.createDiv({ cls: "mt-muted", text: `${formatDuration(st.actualMinutes)} of ${formatDuration(st.targetMinutes)} ${period}` });
        continue;
      }
      const hist = targetHistory(t, c.all, c.today, s.weekStartsOn, 8);
      const box = grid.createDiv({ cls: "mt-panel" });
      box.createEl("h4", { text: `${pathLabel(t.path)} · ${formatDuration(t.minutes)}/${t.period}` });
      progressBar(box, st.completion ?? 0, { marker: st.targetMinutes ? st.expectedByNow / st.targetMinutes : undefined, label: `${pathLabel(t.path)} target progress`, cls: st.met ? "is-met" : st.onPace ? "" : "is-behind", color: st.met || st.onPace ? color : undefined });
      box.createDiv({ text: `${formatDuration(st.actualMinutes)} of ${formatDuration(st.targetMinutes)} · ${formatPercent(st.completion, 0)}` });
      box.createDiv({ cls: "mt-muted", text: st.met ? `Met — ${formatSignedDuration(st.overUnderMinutes)} over` : `${formatDuration(st.remainingMinutes)} left · ${st.onPace ? "on pace" : `behind by ${formatDuration(st.expectedByNow - st.actualMinutes)}`}` });
      const hs = box.createDiv({ cls: "mt-hist", attr: { "aria-label": `Last ${hist.completedPeriods} completed periods: ${hist.metCount} met` } });
      for (const p of hist.periods) hs.createSpan({ cls: "mt-hist-box " + (p.met ? "is-met" : ""), attr: { title: `${p.range.label}: ${formatDuration(p.actualMinutes)} (${formatPercent(p.completion, 0)})` } });
      box.createDiv({ cls: "mt-muted", text: `Hit rate (last ${hist.completedPeriods}): ${formatPercent(hist.hitRate, 0)}` });
    }
  }

  private wBreakdown(board: HTMLElement, c: Ctx): void {
    const tree = this.host.settings.tree;
    const body = this.w(board, "breakdown", "Where your time goes", { sub: this.simple ? "" : c.range.label });
    const cur = rollup(c.rangeEvents, this.simple ? undefined : tree), prv = rollup(c.prevEvents);
    const kids = new Map<string, string[][]>();
    for (const e of cur.values()) { const pk = pathKey(e.path.slice(0, -1)); (kids.get(pk) ?? kids.set(pk, []).get(pk)!).push(e.path); }
    const roots = (this.sc.length ? [this.sc] : kids.get("") ?? []).filter((r) => !this.simple || (cur.get(pathKey(r))?.minutes ?? 0) > 0);
    if (!roots.length) { body.createDiv({ cls: "mt-empty", text: "Nothing tracked in this period." }); return; }
    roots.sort((a, b) => (cur.get(pathKey(b))?.minutes ?? 0) - (cur.get(pathKey(a))?.minutes ?? 0));
    for (const root of roots) this.catRow(body.createDiv({ cls: "mt-cat" }), root, 0, cur.get(pathKey(root))?.minutes ?? 0, cur, prv, kids, c);
  }
  private catRow(parent: HTMLElement, path: string[], depth: number, rootTotal: number, cur: ReturnType<typeof rollup>, prv: ReturnType<typeof rollup>, kids: Map<string, string[][]>, c: Ctx): void {
    const e = cur.get(pathKey(path)) ?? { minutes: 0, sessions: 0, lastDate: null, path };
    if (this.simple && e.minutes === 0) return;
    const maxDepth = this.simple ? 1 : 99;
    const children = depth < maxDepth ? (kids.get(pathKey(path)) ?? []).sort((a, b) => (cur.get(pathKey(b))?.minutes ?? 0) - (cur.get(pathKey(a))?.minutes ?? 0)) : [];
    const makeRow = (host: HTMLElement, leaf = false) => {
      const row = host.createDiv({ cls: "mt-catrow" + (leaf ? " mt-leaf" : "") });
      row.style.paddingLeft = `${depth * 16}px`;
      const name = row.createSpan({ cls: "mt-catname" + (depth === 0 ? " mt-strong" : "") });
      name.createSpan({ cls: "mt-dot-c" }).style.background = this.color(path);
      name.createSpan({ text: path[path.length - 1] });
      const track = row.createDiv({ cls: "mt-htrack" });
      const fill = track.createDiv({ cls: "mt-hfill" });
      fill.style.width = `${rootTotal > 0 ? Math.min(100, (e.minutes / rootTotal) * 100) : 0}%`;
      fill.style.background = this.color(path);
      const tot = row.createEl("button", { cls: "mt-linkbtn", text: formatDuration(e.minutes), attr: { "aria-label": `${pathLabel(path)}: ${formatDuration(e.minutes)}. Show events` } });
      tot.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); this.drillPath(path, c.range.start, c.range.end > c.today ? c.today : c.range.end); });
      if (!this.simple) {
        row.createSpan({ cls: "mt-muted mt-catsess", text: `${e.sessions}×` });
        const d = this.deltaText(delta(e.minutes, prv.get(pathKey(path))?.minutes ?? 0));
        row.createSpan({ cls: `mt-catdelta ${d.cls}`, text: d.text, attr: { title: `vs ${c.prev.label}` } });
        row.createSpan({ cls: "mt-muted mt-catlast", text: e.lastDate ? this.fmtDate(e.lastDate) : "" });
      }
    };
    if (children.length) {
      const det = parent.createEl("details"); det.open = !this.simple && depth < 1;
      makeRow(det.createEl("summary"));
      for (const ch of children) this.catRow(det, ch, depth + 1, rootTotal, cur, prv, kids, c);
    } else makeRow(parent, true);
  }

  private wComparison(board: HTMLElement, c: Ctx): void {
    const cmp = compareStats(c.stats, c.prevStats);
    if (this.simple) {
      const body = this.w(board, "comparison", "");
      body.addClass("mt-compare-simple");
      const m = cmp.minutes, label = c.prev.label.toLowerCase();
      const line = body.createDiv({ cls: "mt-compare-line" });
      if (m.kind === "pct") {
        const up = m.diff! >= 0;
        this.renderIcon(line, up ? "trending-up" : "trending-down").addClass(up ? "mt-up" : "mt-down");
        line.createSpan({ text: m.diff === 0 ? `Same as ${label}` : `${Math.abs(m.pct!).toFixed(0)}% ${up ? "more" : "less"} than ${label}` });
        line.createSpan({ cls: "mt-muted", text: ` (${formatSignedDuration(m.diff!)})` });
      } else if (m.kind === "new") { this.renderIcon(line, "sparkles"); line.createSpan({ text: "A fresh start — nothing to compare with yet" }); }
      else line.createSpan({ cls: "mt-muted", text: "Nothing to compare yet" });
      return;
    }
    const body = this.w(board, "comparison", `${c.range.label} vs ${c.prev.label}`, { sub: `${this.fmtDate(c.range.start)} → ${this.fmtDate(c.stats.end)} vs ${this.fmtDate(c.prev.start)} → ${this.fmtDate(c.prev.end)}` });
    const tbl = body.createEl("table", { cls: "mt-table" });
    const head = tbl.createEl("thead").createEl("tr"); ["", "Now", "Before", "Difference", "Change"].forEach((x) => head.createEl("th", { text: x }));
    const row = (label: string, d: Delta, f: (n: number) => string, signed: (n: number) => string) => {
      const tr = tbl.createEl("tr"); tr.createEl("td", { text: label });
      tr.createEl("td", { text: d.current === null ? "–" : f(d.current) }); tr.createEl("td", { text: d.previous === null ? "–" : f(d.previous) });
      tr.createEl("td", { text: d.diff === null ? "–" : signed(d.diff) });
      const dt = this.deltaText(d); tr.createEl("td", { text: d.kind === "new" ? "new (nothing before)" : dt.text, cls: dt.cls });
    };
    const sgn = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
    row("Time", cmp.minutes, formatDuration, formatSignedDuration);
    row("Sessions", cmp.sessions, String, sgn);
    row("Active days", cmp.activeDays, String, sgn);
    row("Avg per day", cmp.avgPerCalendarDay, formatDuration, formatSignedDuration);
  }

  private wAttention(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings;
    const items = evaluateNeglect(s.tree, c.all, c.today, s.neglect.defaultThresholdDays).filter((i) => !this.sc.length || this.sc.every((x, k) => i.path[k] === x));
    const bad = items.filter((i) => i.status === "neglected");
    const body = this.w(board, "attention", "Needs attention");
    if (!bad.length) { const l = body.createDiv({ cls: "mt-ok" }); this.renderIcon(l, "check"); l.createSpan({ text: this.simple ? "You’re all caught up" : "Nothing is overdue" }); }
    for (const i of bad) {
      const row = body.createDiv({ cls: "mt-neglect" });
      row.createSpan({ cls: "mt-dot-c" }).style.background = this.color(i.path);
      row.createSpan({ cls: "mt-neglect-name", text: i.path[i.path.length - 1] });
      row.createSpan({ cls: "mt-muted", text: this.simple ? `${i.daysSince} days ago` : `last ${i.daysSince} days ago (${this.fmtDate(i.lastDate!)}) · threshold ${i.threshold}` });
    }
    const quiet = items.filter((i) => i.status !== "neglected" && i.status !== "ok");
    if (!this.simple && quiet.length) {
      const d = body.createEl("details", { cls: "mt-details" });
      d.createEl("summary", { text: `Not flagged (${quiet.length})` });
      for (const i of quiet) d.createDiv({ cls: "mt-muted", text: `${pathLabel(i.path)} — ${i.status === "never" ? "no activity yet" : i.status === "intentional" ? "intentionally inactive" : "paused"}` });
    }
  }

  private wRecent(board: HTMLElement, c: Ctx): void {
    const grid = this.w(board, "recent", "Recent activity").createDiv({ cls: "mt-cards" });
    for (const n of [7, 14, 30]) {
      const r = resolveRange({ id: "lastN", n }, c.today, this.host.resolveOpts());
      const p = previousRange(r, c.today);
      const cur = computeStats(c.events, r, c.today), pv = computeStats(c.events, p, c.today);
      const d = this.deltaText(delta(cur.totalMinutes, pv.totalMinutes));
      const el = this.card(grid, `Last ${n} days`, formatDuration(cur.totalMinutes), `${formatDuration(cur.avgPerCalendarDay)}/day · ${d.text}`);
      el.addClass("mt-clickable"); el.tabIndex = 0;
      el.addEventListener("click", () => this.drill(`Last ${n} days`, (e) => this.inScope(e) && e.date >= r.start && e.date <= r.end));
    }
  }

  // ---------- analysis widgets ----------
  private wKeyNumbers(board: HTMLElement, c: Ctx): void {
    const body = this.w(board, "keyNumbers", "Key numbers", { sub: c.range.label });
    const grid = body.createDiv({ cls: "mt-cards" });
    for (const id of this.host.settings.dashboard.metrics) { const m = metricById(id); if (m) this.card(grid, m.label, m.format(c.stats), undefined, m.definition); }
  }

  private stacked(c: Ctx, buckets: Bucket[], gran: Granularity, make: (b: Bucket) => BarItem): { items: BarItem[]; legend: { name: string; color: string }[] } {
    const ws = this.host.settings.weekStartsOn, depth = this.sc.length;
    const by = new Map<string, Map<string, number>>(), totals = new Map<string, number>();
    const lo = buckets[0]?.start, hi = buckets[buckets.length - 1]?.end;
    for (const e of c.events) {
      if (!lo || e.date < lo || e.date > hi) continue;
      const bs = bucketStartOf(e.date, gran, ws), name = e.path[depth] ?? "(direct)";
      const m = by.get(bs) ?? by.set(bs, new Map()).get(bs)!;
      m.set(name, (m.get(name) ?? 0) + e.durationMinutes);
      totals.set(name, (totals.get(name) ?? 0) + e.durationMinutes);
    }
    const items = buckets.map((b) => ({ ...make(b), parts: [...(by.get(b.start) ?? [])].map(([name, value]) => ({ name, value, color: this.color([...this.sc, name]) })) }));
    return { items, legend: [...totals].sort((a, b) => b[1] - a[1]).map(([name]) => ({ name, color: this.color([...this.sc, name]) })) };
  }
  private bucketItem(b: Bucket, gran: Granularity): BarItem {
    return { label: gran === "month" ? formatMonthLabel(b.key, this.host.settings.dateFormat) : formatShortDate(b.start, this.host.settings.dateFormat), value: b.minutes, key: b.key, title: `${gran === "day" ? this.fmtDate(b.start) : gran === "week" ? "Week of " + this.fmtDate(b.start) : b.key}: ${formatDuration(b.minutes)}, ${plural(b.sessions, "session")}` };
  }

  private wChartActivity(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings, days = c.stats.calendarDays;
    if (!days) return;
    const gran: Granularity = days <= 62 ? "day" : days <= 400 ? "week" : "month", el = { start: c.range.start, end: c.stats.end };
    const body = this.w(board, "chartActivity", `Activity over time`, { sub: gran === "day" ? `${s.charts.movingAverageWindow}-day average line` : gran === "week" ? "weekly" : "monthly" });
    const buckets = bucketSeries(c.events, el.start, el.end, gran, s.weekStartsOn);
    const st = this.stacked(c, buckets, gran, (b) => this.bucketItem(b, gran));
    legend(body, st.legend);
    barChart(body, { items: st.items, line: gran === "day" ? movingAverage(buckets.map((b) => b.minutes), s.charts.movingAverageWindow) : undefined, lineLabel: `${s.charts.movingAverageWindow}-day moving average`, aria: "Activity over time", onSelect: (it) => { const b = buckets.find((x) => x.key === it.key)!; const s0 = b.start < el.start ? el.start : b.start, e0 = b.end > el.end ? el.end : b.end; this.drillPath(this.sc, s0, e0, `${this.sc.length ? pathLabel(this.sc) : "All activity"} · ${this.fmtDate(s0)}${s0 === e0 ? "" : " → " + this.fmtDate(e0)}`); } });
  }
  private wChartBuckets(board: HTMLElement, c: Ctx, kind: "weekly" | "monthly"): void {
    const s = this.host.settings, week = kind === "weekly", gran: Granularity = week ? "week" : "month";
    const start = week ? addDays(startOfWeek(c.today, s.weekStartsOn), -77) : shiftMonthStart(c.today, -11);
    const buckets = bucketSeries(c.events, start, c.today, gran, s.weekStartsOn);
    const body = this.w(board, week ? "chartWeekly" : "chartMonthly", week ? "Weekly activity" : "Monthly activity", { wide: false, sub: week ? "last 12 weeks" : "last 12 months" });
    const st = this.stacked(c, buckets, gran, (b) => this.bucketItem(b, gran));
    legend(body, st.legend);
    barChart(body, { items: st.items, aria: week ? "Weekly activity" : "Monthly activity", onSelect: (it) => { const b = buckets.find((x) => x.key === it.key)!; this.drillPath(this.sc, b.start, b.end, week ? `Week of ${this.fmtDate(b.start)}` : it.label); } });
  }

  private wDistribution(board: HTMLElement, c: Ctx): void {
    const body = this.w(board, "chartDistribution", this.sc.length ? `Within ${this.sc[this.sc.length - 1]}` : "Distribution", { wide: false, sub: "click a row to filter" });
    hBars(body, distribution(c.rangeEvents, this.sc).map((sl) => ({ label: sl.name, value: sl.minutes, color: this.color(sl.path), text: `${formatDuration(sl.minutes)} · ${formatPercent(sl.share, 0)}`, onClick: sl.path.length > this.sc.length ? () => { this.scopeIds = sl.path; this.render(); } : undefined })));
    if (!this.sc.length) {
      const by = new Map<string, { label: string; minutes: number; path: string[] }>();
      for (const e of c.rangeEvents) if (e.path.length > 1) { const p = e.path.slice(0, 2), k = pathKey(p), g = by.get(k) ?? { label: p[1], minutes: 0, path: p }; g.minutes += e.durationMinutes; by.set(k, g); }
      const total = sum([...by.values()].map((g) => g.minutes));
      body.createEl("h4", { cls: "mt-subhead", text: "By subject" });
      hBars(body, [...by.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 10).map((g) => ({ label: g.label, value: g.minutes, color: this.color(g.path), text: `${formatDuration(g.minutes)} · ${formatPercent(total ? g.minutes / total : null, 0)}`, onClick: () => { this.scopeIds = g.path; this.render(); } })));
    }
  }

  private wCumulative(board: HTMLElement, c: Ctx): void {
    if (!c.stats.calendarDays) return;
    const body = this.w(board, "chartCumulative", "Cumulative time", { wide: false, sub: `${c.range.label} vs ${c.prev.label.toLowerCase()}` });
    const cur = dailySeries(c.rangeEvents, c.range.start, c.stats.end).map((p) => p.minutes);
    const prev = dailySeries(c.prevEvents, c.prev.start, c.prev.end > c.today ? c.today : c.prev.end).map((p) => p.minutes);
    lineChart(body, { series: [{ name: c.range.label, values: cumulative(cur), cls: "mt-line" }, { name: c.prev.label, values: cumulative(prev), cls: "mt-line-prev" }], xLabel: (i) => `day ${i + 1}`, aria: "Cumulative time, current versus previous period" });
  }

  private wPlanned(board: HTMLElement, c: Ctx): void {
    const planned = c.rangeEvents.filter((e) => e.plannedMinutes && e.plannedMinutes > 0);
    if (!planned.length) return;
    const body = this.w(board, "chartPlanned", "Planned vs actual", { wide: false });
    for (const sl of distribution(planned, this.sc)) {
      const evs = planned.filter((e) => sl.path.every((x, i) => e.path[i] === x));
      const pl = sum(evs.map((e) => e.plannedMinutes!)), ac = sum(evs.map((e) => e.durationMinutes));
      const line = body.createDiv({ cls: "mt-pva" });
      line.createDiv({ text: `${sl.name}: ${formatDuration(ac)} of ${formatDuration(pl)} (${formatPercent(pl ? ac / pl : null, 0)})` });
      progressBar(line, pl ? ac / pl : 0, { label: `${sl.name} actual versus planned`, color: this.color(sl.path) });
    }
  }

  private wLongestSessions(board: HTMLElement, c: Ctx): void {
    const body = this.w(board, "longestSessions", "Longest sessions", { wide: false });
    const top = topSessions(c.rangeEvents, 5);
    if (!top.length) body.createDiv({ cls: "mt-empty", text: "No sessions in this range." });
    for (const e of top) {
      const r = body.createDiv({ cls: "mt-listrow mt-clickable" }); r.tabIndex = 0;
      const l = r.createSpan(); l.createSpan({ cls: "mt-dot-c" }).style.background = this.color(e.path);
      l.createSpan({ text: `${formatDuration(e.durationMinutes)} · ${pathLabel(e.path.length > 1 ? e.path.slice(1) : e.path)}` });
      r.createSpan({ cls: "mt-muted", text: this.fmtDate(e.date) });
      r.addEventListener("click", () => this.drill(this.fmtDate(e.date), (x) => x.date === e.date && this.inScope(x)));
    }
  }
  private wLongestGaps(board: HTMLElement, c: Ctx): void {
    const body = this.w(board, "longestGaps", "Longest gaps", { wide: false, sub: "idle days in between" });
    const gaps = topGaps([...new Set(c.rangeEvents.map((e) => e.date))], 3);
    if (!gaps.length) body.createDiv({ cls: "mt-empty", text: "No gaps." });
    for (const g of gaps) body.createDiv({ cls: "mt-listrow" }).createSpan({ text: `${plural(g.days, "day")} · ${this.fmtDate(g.from)}${g.from === g.to ? "" : " → " + this.fmtDate(g.to)}` });
  }
  private wPeaks(board: HTMLElement, c: Ctx): void {
    const body = this.w(board, "peaks", "Peaks", { wide: false });
    const st = c.stats;
    const day = st.peakWeekday ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][st.peakWeekday.weekday] : "–";
    for (const [k, v] of [["Best day", st.peakDay ? `${this.fmtDate(st.peakDay.date)} · ${formatDuration(st.peakDay.minutes)}` : "–"], ["Best weekday", day], ["Best time of day", st.peakPeriod?.label ?? "–"]]) { const r = body.createDiv({ cls: "mt-listrow" }); r.createSpan({ cls: "mt-muted", text: k }); r.createSpan({ text: v }); }
  }

  private wResults(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings;
    const rs = resultStats(c.rangeEvents, s.resultScale), ms = measurementStats(c.rangeEvents, s.measurements).filter((m) => m.n > 0);
    if (!rs.rated && !ms.length) return;
    const body = this.w(board, "results", "Results & grades", { sub: "your own marks — not a measure of ability" });
    if (rs.rated) { const g = body.createDiv({ cls: "mt-chips" }); for (const x of rs.counts.filter((q) => q.count)) this.chip(g, `${x.label} × ${x.count}`); }
    for (const m of ms) body.createDiv({ text: `${m.def.name}: average ${m.mean!.toFixed(1)}${m.def.unit === "%" ? "%" : ""} (${m.min}–${m.max}, ${plural(m.n, "session")})` });
    const idx = performanceIndex(c.rangeEvents, s.resultScale, s.measurements, s.performance);
    if (idx.index !== null) { body.createDiv({ cls: "mt-strong", text: `Performance index: ${idx.index.toFixed(1)} / 100` }).setAttribute("title", describeIndexFormula(s.performance, s.measurements)); body.createDiv({ cls: "mt-muted", text: describeIndexFormula(s.performance, s.measurements) }); }
  }

  private wRecall(board: HTMLElement, c: Ctx): void {
    const s = this.host.settings;
    const rc = recallStats(c.all, this.sc, c.range, c.today, s.recallKinds);
    const body = this.w(board, "recall", "Recall & revision");
    if (!rc.sessions && rc.lastRecallDate === null) { body.createDiv({ cls: "mt-empty", text: `No recall sessions yet — mark one with a type such as ${s.recallKinds.join(", ")}.` }); return; }
    const grid = body.createDiv({ cls: "mt-cards" });
    this.card(grid, "Sessions", String(rc.sessions), c.range.label);
    this.card(grid, "Time", formatDuration(rc.minutes));
    this.card(grid, "Frequency", rc.frequencyPerWeek === null ? "–" : `${rc.frequencyPerWeek.toFixed(1)}/week`);
    this.card(grid, "Since last", rc.daysSinceLastRecall === null ? "–" : rc.daysSinceLastRecall === 0 ? "Today" : `${rc.daysSinceLastRecall}d`);
    const sub = body.createDiv({ cls: "mt-subgrid" });
    const recallEvents = c.events.filter((e) => isRecall(e, s.recallKinds));
    const wk = bucketSeries(recallEvents, addDays(startOfWeek(c.today, s.weekStartsOn), -77), c.today, "week", s.weekStartsOn);
    const p1 = sub.createDiv({ cls: "mt-panel" }); p1.createEl("h4", { text: "Per week" });
    barChart(p1, { items: wk.map((b) => this.bucketItem(b, "week")), aria: "Recall time per week", onSelect: (it) => { const b = wk.find((x) => x.key === it.key)!; this.drill(`Recall · week of ${this.fmtDate(b.start)}`, (e) => this.inScope(e) && isRecall(e, s.recallKinds) && e.date >= b.start && e.date <= b.end); } });
    const p2 = sub.createDiv({ cls: "mt-panel" }); p2.createEl("h4", { text: "Days since last recall" });
    hBars(p2, rc.bySubject.slice(0, 10).map((x) => ({ label: pathLabel(x.path.length > 1 ? x.path.slice(1) : x.path), value: x.daysSince ?? 0, color: this.color(x.path), text: x.daysSince === 0 ? "today" : `${x.daysSince}d`, sub: `${x.sessions} in range` })));
    if (rc.byKind.length) { const p3 = sub.createDiv({ cls: "mt-panel" }); p3.createEl("h4", { text: "By type" }); hBars(p3, rc.byKind.map((k) => ({ label: k.kind, value: k.sessions, text: `${k.sessions}× · ${formatDuration(k.minutes)}` }))); }
    if (s.recall.srsEnabled) {
      const due = spacedRepetition(c.all, this.sc, c.today, s.recallKinds, s.recall.intervals).filter((i) => i.nextDue <= c.today).slice(0, 10);
      const p4 = sub.createDiv({ cls: "mt-panel" }); p4.createEl("h4", { text: "Due for review" });
      if (!due.length) p4.createDiv({ cls: "mt-ok", text: "Nothing is due." });
      for (const i of due) p4.createDiv({ cls: "mt-listrow" }).createSpan({ text: `${pathLabel(i.path.length > 1 ? i.path.slice(1) : i.path)} — ${this.fmtDate(i.nextDue)}${i.overdueDays ? ` (${i.overdueDays}d late)` : ""}` });
    }
  }
}

/**
 * Charts for the analysis sections of the Advanced dashboard. One accent (the brand purple), subject colours only where
 * a subject is the thing being shown, styled hover cards (see tooltip.ts) with exact values, and keyboard-focusable
 * marks. Reuses svg()/responsive() from charts.ts.
 */
import { responsive, svg } from "./charts";
import { attachTip, type TipRow } from "./tooltip";
import { formatDuration, formatPercentChange, formatSignedDuration } from "../core/duration";
import { countAxis, type HistBin, type Heatmap, type SubjectChange } from "../core/analysis";
import type { Slice } from "../core/stats";

const empty = (parent: HTMLElement, text: string) => parent.createDiv({ cls: "mt-empty", text });
const activate = (el: Element, fn: () => void, label: string) => {
  el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); el.setAttribute("aria-label", label);
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e) => { const k = (e as KeyboardEvent).key; if (k === "Enter" || k === " ") { e.preventDefault(); fn(); } });
};

// ------------------------------------------------------------------ heatmap

export interface HeatOpts {
  monthLabel: (key: string) => string; weekdayLabel: (weekday: number) => string; fmtDate: (d: string) => string;
  /** today's date key: the cell gets an outline */
  today?: string; onSelect?: (date: string) => void;
}
const HEAT_WORDS = ["", "Light", "Moderate", "Busy", "Busiest"];
/** GitHub-style grid: one column per week, one row per weekday, intensity = minutes (quartile levels, see core/analysis). */
export function heatmapChart(parent: HTMLElement, h: Heatmap, o: HeatOpts): void {
  const cols = h.columns.length;
  if (!cols) { empty(parent, "No data."); return; }
  const wrap = parent.createDiv({ cls: "mt-an-heat" });
  responsive(wrap, (w) => {
    const padL = 34, padT = 20, gap = 4;
    const cell = Math.max(10, Math.min(28, Math.floor((w - padL) / cols) - gap));
    const width = padL + cols * (cell + gap) - gap, height = padT + 7 * (cell + gap) - gap;
    const el = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "Activity heatmap", class: "mt-svg" });
    h.monthStarts.forEach((m, i) => { const next = h.monthStarts[i + 1]; if (next && next.col - m.col < 3) return; svg("text", { x: padL + m.col * (cell + gap), y: 11, class: "mt-axis" }, el).textContent = o.monthLabel(m.key); });
    h.rowWeekdays.forEach((wd, r) => { if (r % 2 === 1) svg("text", { x: padL - 8, y: padT + r * (cell + gap) + cell / 2 + 3.5, "text-anchor": "end", class: "mt-axis" }, el).textContent = o.weekdayLabel(wd); });
    h.columns.forEach((col, c) => col.forEach((d, r) => {
      const rect = svg("rect", { x: padL + c * (cell + gap), y: padT + r * (cell + gap), width: cell, height: cell, rx: cell >= 14 ? 4 : 3, class: `mt-heat-c l${d.level}${d.inRange ? "" : " is-out"}${d.date === o.today ? " is-today" : ""}` }, el);
      const wd = new Date(`${d.date}T12:00:00`).getDay();
      attachTip(rect, () => ({
        title: `${o.weekdayLabel(wd)}, ${o.fmtDate(d.date)}`,
        sub: d.minutes > 0 ? undefined : "No activity",
        rows: d.minutes > 0 ? [{ label: "Time", value: formatDuration(d.minutes), strong: true }, { label: "Intensity", value: HEAT_WORDS[d.level], muted: true }] : [],
        foot: d.inRange ? undefined : "Outside the selected range",
      }));
      if (o.onSelect && d.minutes > 0) { activate(rect, () => o.onSelect!(d.date), `${o.fmtDate(d.date)}: ${formatDuration(d.minutes)}`); rect.classList.add("mt-clickable"); }
    }));
    // in a narrow pane the grid scrolls sideways: start at the most recent weeks, not at the oldest
    requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
    return el;
  });
  const lg = parent.createDiv({ cls: "mt-an-heat-legend" });
  lg.createSpan({ cls: "mt-muted", text: "Less" });
  for (let l = 0; l <= 4; l++) lg.createSpan({ cls: `mt-heat-key mt-heat-c l${l}` });
  lg.createSpan({ cls: "mt-muted", text: "More" });
}

// ------------------------------------------------------------------ subjects / composition

export interface BarsOpts {
  colorOf: (s: Slice) => string; onEvents: (s: Slice) => void; canDrill: (s: Slice) => boolean; onDrill: (s: Slice) => void; limit?: number; fmtPct: (n: number | null) => string;
  /** change against the previous period for a subject; omit when there is no previous period */
  changeOf?: (s: Slice) => SubjectChange | undefined; prevLabel?: string;
}
function chipFor(c: SubjectChange): { text: string; cls: string; label: string } {
  if (c.kind === "new") return { text: "new", cls: "is-new", label: "Nothing in the previous period" };
  if (c.kind === "flat" || c.pct === null) return { text: "–", cls: "is-flat", label: "No change" };
  const up = c.diff > 0;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(c.pct) >= 10 ? Math.abs(c.pct).toFixed(0) : Math.abs(c.pct).toFixed(1)}%`, cls: up ? "is-up" : "is-down", label: `${formatPercentChange(c.pct)} (${formatSignedDuration(c.diff)})` };
}
/** Ranked horizontal bars. A tick on each bar marks the previous period, a chip says how far it moved. Row click = events; "›" = break down. */
export function subjectBars(parent: HTMLElement, groups: Slice[], o: BarsOpts): void {
  if (!groups.length) { empty(parent, "No activity in this range."); return; }
  const limit = o.limit ?? 10;
  const shown = groups.slice(0, limit);
  const max = Math.max(...shown.map((g) => g.minutes), ...shown.map((g) => o.changeOf?.(g)?.previous ?? 0), 1e-9);
  const list = parent.createDiv({ cls: "mt-an-bars" });
  for (const g of shown) {
    const ch = o.changeOf?.(g);
    const row = list.createDiv({ cls: "mt-an-bar-row" });
    const main = row.createEl("button", { cls: "mt-an-bar-main", attr: { "aria-label": `${g.name}: ${formatDuration(g.minutes)}, ${o.fmtPct(g.share)}${ch ? `, ${chipFor(ch).label}` : ""}. Show events` } });
    const lab = main.createSpan({ cls: "mt-an-bar-label" });
    lab.createSpan({ cls: "mt-dot-c" }).style.background = o.colorOf(g);
    lab.createSpan({ cls: "mt-an-bar-name", text: g.name });
    const track = main.createDiv({ cls: "mt-htrack mt-an-track" });
    const fill = track.createDiv({ cls: "mt-hfill" }); fill.style.width = `${(g.minutes / max) * 100}%`; fill.style.background = o.colorOf(g);
    if (ch && ch.previous > 0) track.createDiv({ cls: "mt-ghost-mark" }).style.left = `${(ch.previous / max) * 100}%`;
    const val = main.createSpan({ cls: "mt-an-bar-val" });
    val.createSpan({ cls: "mt-an-bar-time", text: formatDuration(g.minutes) });
    val.createSpan({ cls: "mt-an-bar-pct", text: o.fmtPct(g.share) });
    if (o.changeOf) { if (ch) { const c = chipFor(ch); main.createSpan({ cls: `mt-delta ${c.cls}`, text: c.text }); } else main.createSpan({ cls: "mt-delta is-flat", text: "" }); }
    main.addEventListener("click", () => o.onEvents(g));
    attachTip(main, () => {
      const rows: TipRow[] = [{ label: "This period", value: formatDuration(g.minutes), strong: true }];
      if (ch) { rows.push({ label: o.prevLabel ?? "Previous period", value: ch.previous > 0 ? formatDuration(ch.previous) : "none", muted: true }); if (ch.kind !== "flat") rows.push({ label: "Change", value: ch.pct === null ? formatSignedDuration(ch.diff) : `${formatSignedDuration(ch.diff)} · ${formatPercentChange(ch.pct)}` }); }
      rows.push({ label: "Share of total", value: o.fmtPct(g.share), muted: true });
      return { title: g.name, sub: g.sessions ? `${g.sessions} ${g.sessions === 1 ? "record" : "records"}` : undefined, rows, foot: "Click for events" };
    });
    if (o.canDrill(g)) {
      const drill = row.createEl("button", { cls: "mt-an-drill clickable-icon", text: "›", attr: { "aria-label": `Break down ${g.name}` } });
      drill.addEventListener("click", () => o.onDrill(g));
      attachTip(drill, () => ({ title: `Break down ${g.name}`, sub: "Filters the whole dashboard to this subject" }));
    } else row.createSpan({ cls: "mt-an-drill-spacer" });
  }
  if (groups.length > limit) list.createDiv({ cls: "mt-muted mt-an-more-groups", text: `+ ${groups.length - limit} smaller groups` });
}

export interface DonutOpts { colorOf: (s: Slice) => string; total: number; onSelect?: (s: Slice) => void; fmtPct: (n: number | null) => string }
/** Composition donut. Hovering a segment or a legend row focuses it: the others dim and the centre shows its time. */
export function donutChart(parent: HTMLElement, slices: Slice[], o: DonutOpts): void {
  const wrap = parent.createDiv({ cls: "mt-an-donut" });
  const size = 176, sw = 22, r = (size - sw) / 2, c = size / 2, C = 2 * Math.PI * r;
  const el = svg("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": "Time distribution", class: "mt-svg mt-donut-svg" });
  svg("circle", { cx: c, cy: c, r, "stroke-width": sw, class: "mt-ring-track" }, el);
  const arcs = new Map<Slice, SVGElement>();
  const rows = new Map<Slice, HTMLElement>();
  const centreMain = svg("text", { x: c, y: c + 2, "text-anchor": "middle", class: "mt-donut-main" }, el);
  const centreSub = svg("text", { x: c, y: c + 20, "text-anchor": "middle", class: "mt-donut-sub" }, el);
  const clip = (t: string) => (t.length > 16 ? `${t.slice(0, 15)}…` : t);
  const focus = (s: Slice | null) => {
    el.classList.toggle("is-focus", !!s);
    arcs.forEach((a, k) => a.classList.toggle("is-active", k === s));
    rows.forEach((r2, k) => r2.classList.toggle("is-active", k === s));
    centreMain.textContent = formatDuration(s ? s.minutes : o.total);
    centreSub.textContent = s ? clip(s.name) : "total";
  };
  let acc = 0;
  for (const s of slices) {
    const share = o.total > 0 ? s.minutes / o.total : 0, len = Math.max(0, C * share - (slices.length > 1 ? 3 : 0));
    const arc = svg("circle", { cx: c, cy: c, r, "stroke-width": sw, "stroke-dasharray": `${len} ${C}`, "stroke-dashoffset": -acc, transform: `rotate(-90 ${c} ${c})`, class: "mt-an-arc" }, el);
    arc.setAttribute("style", `stroke:${o.colorOf(s)}`);
    arcs.set(s, arc);
    const tipOf = () => ({ title: s.name, rows: [{ label: "Time", value: formatDuration(s.minutes), strong: true }, { label: "Share", value: o.fmtPct(s.share), muted: true }], sub: s.sessions ? `${s.sessions} ${s.sessions === 1 ? "record" : "records"}` : undefined });
    attachTip(arc, tipOf);
    arc.addEventListener("pointerenter", () => focus(s)); arc.addEventListener("pointerleave", () => focus(null));
    if (o.onSelect && s.path.length) { activate(arc, () => o.onSelect!(s), `${s.name}: ${formatDuration(s.minutes)}`); arc.classList.add("mt-clickable"); arc.addEventListener("focus", () => focus(s)); arc.addEventListener("blur", () => focus(null)); }
    acc += C * share;
  }
  focus(null);
  wrap.appendChild(el);
  const legend = wrap.createDiv({ cls: "mt-an-donut-legend" });
  for (const s of slices) {
    const row = legend.createDiv({ cls: "mt-an-legend-row" + (o.onSelect && s.path.length ? " mt-clickable" : "") });
    rows.set(s, row);
    row.createSpan({ cls: "mt-dot-c" }).style.background = o.colorOf(s);
    row.createSpan({ cls: "mt-an-legend-name", text: s.name });
    row.createSpan({ cls: "mt-an-legend-time", text: formatDuration(s.minutes) });
    row.createSpan({ cls: "mt-an-legend-pct", text: o.fmtPct(s.share) });
    row.addEventListener("pointerenter", () => focus(s)); row.addEventListener("pointerleave", () => focus(null));
    if (o.onSelect && s.path.length) row.addEventListener("click", () => o.onSelect!(s));
  }
}

// ------------------------------------------------------------------ sessions

/** A bar with rounded top corners only (the base sits flat on the axis). */
const roundedTop = (x: number, y: number, w: number, h: number, r: number): string => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

export interface HistOpts { onSelect?: (b: HistBin) => void; /** the bin holding this duration (the median) is emphasised */ highlightMinutes?: number | null }
export function histogramChart(parent: HTMLElement, bins: HistBin[], o: HistOpts): void {
  if (!bins.some((b) => b.count > 0)) { empty(parent, "No sessions in this range."); return; }
  const total = bins.reduce((a, b) => a + b.count, 0);
  const hi = o.highlightMinutes !== null && o.highlightMinutes !== undefined ? bins.find((b) => o.highlightMinutes! >= b.min && o.highlightMinutes! < b.max) : undefined;
  responsive(parent, (w) => {
    const H = 170, padL = 30, padR = 6, padT = 18, padB = 24, plotW = w - padL - padR, plotH = H - padT - padB;
    const axis = countAxis(Math.max(...bins.map((b) => b.count)));
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": "Distribution of session lengths", class: "mt-svg" });
    for (const t of axis.ticks) {
      const y = padT + plotH * (1 - t / axis.max);
      svg("line", { x1: padL, x2: w - padR, y1: y, y2: y, class: t === 0 ? "mt-grid is-base" : "mt-grid" }, el);
      svg("text", { x: padL - 8, y: y + 3.5, "text-anchor": "end", class: "mt-axis" }, el).textContent = String(t);
    }
    const bw = plotW / bins.length, barW = Math.max(4, Math.min(bw - 10, 56));
    bins.forEach((b, i) => {
      const cx = padL + i * bw + bw / 2, x = cx - barW / 2, h = (b.count / axis.max) * plotH;
      const g = svg("g", { class: "mt-col" }, el);
      svg("rect", { x: padL + i * bw, y: padT, width: bw, height: plotH, rx: 4, class: "mt-hit" }, g);
      if (b.count > 0) {
        svg("path", { d: roundedTop(x, padT + plotH - h, barW, Math.max(h, 2), 5), class: "mt-an-bin" + (b === hi ? " is-median" : "") }, g);
        svg("text", { x: cx, y: padT + plotH - h - 5, "text-anchor": "middle", class: "mt-bar-count" }, g).textContent = String(b.count);
      } else svg("rect", { x: cx - 5, y: padT + plotH - 2, width: 10, height: 2, rx: 1, class: "mt-bar-zero" }, g);
      svg("text", { x: cx, y: H - 6, "text-anchor": "middle", class: "mt-axis" }, el).textContent = b.label;
      attachTip(g, () => ({ title: b.label, rows: [{ label: "Sessions", value: String(b.count), strong: true }, { label: "Share of sessions", value: `${Math.round((b.count / total) * 100)}%`, muted: true }], foot: b === hi ? "Contains your median session" : undefined }));
      if (o.onSelect && b.count > 0) { activate(g, () => o.onSelect!(b), `${b.label}: ${b.count} session${b.count === 1 ? "" : "s"}`); g.classList.add("mt-clickable"); }
    });
    return el;
  });
  if (hi) { const k = parent.createDiv({ cls: "mt-legend mt-hist-key" }).createSpan({ cls: "mt-legend-item" }); k.createSpan({ cls: "mt-swatch-bar" }); k.createSpan({ text: "holds your median session" }); }
}

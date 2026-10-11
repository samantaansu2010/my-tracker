
/** Small dependency-free SVG/HTML charts.
 * Everything is keyboard-focusable and has text alternatives. */
import { formatDuration } from "../core/duration";
import { attachTip, type TipRow } from "./tooltip";

const NS = "http://www.w3.org/2000/svg";

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

/** Redraws whenever the container is resized, so text stays at a readable size. */
export function responsive(parent: HTMLElement, draw: (width: number) => SVGElement): void {
  const host = parent.createDiv({ cls: "mt-chart" });
  const render = () => { const w = Math.max(240, Math.floor(host.clientWidth || 600)); host.empty(); host.appendChild(draw(w)); };
  render();
  if (typeof ResizeObserver !== "undefined") {
    let last = host.clientWidth;
    const ro = new ResizeObserver(() => { if (!host.isConnected) { ro.disconnect(); return; } if (Math.abs(host.clientWidth - last) > 8) { last = host.clientWidth; render(); } });
    ro.observe(host);
  }
}

export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
/** Rounds the axis max to a tidy value in minutes (whole hours once above 2h). */
export function axisMax(maxMinutes: number): number {
  return maxMinutes >= 120 ? niceMax(maxMinutes / 60) * 60 : niceMax(maxMinutes);
}

let uid = 0;
export interface BarPart { value: number; color: string; name: string }
export interface BarItem {
  label: string; value: number; key: string; title: string; parts?: BarPart[];
  /** tooltip heading (a readable date); falls back to the axis label */
  heading?: string; sub?: string;
  /** the same position in the previous period, drawn as a tick on the bar; null = no data for it */
  ghost?: number | null;
}
export interface BarOpts {
  items: BarItem[]; line?: (number | null)[]; lineLabel?: string; ghostLabel?: string; height?: number; aria: string;
  fmt?: (n: number) => string; onSelect?: (item: BarItem) => void;
}

/**
 * Stacked bars with rounded tops, a hover column that shows a styled tooltip (per-part breakdown, total, moving average,
 * previous period), previous-period ticks and a smoothed average line. Days without activity keep a faint baseline mark
 * so a quiet day reads as "nothing here", not as a drawing defect.
 */
export function barChart(parent: HTMLElement, o: BarOpts): void {
  const fmt = o.fmt ?? formatDuration;
  const H = o.height ?? 200;
  if (!o.items.length) { parent.createDiv({ cls: "mt-empty", text: "No data in this range." }); return; }
  responsive(parent, (w) => {
    const padL = 44, padR = 4, padT = 12, padB = 24, plotW = w - padL - padR, plotH = H - padT - padB, n = o.items.length;
    const raw = Math.max(0, ...o.items.map((i) => i.value), ...(o.line ?? []).map((v) => v ?? 0), ...o.items.map((i) => i.ghost ?? 0));
    const max = axisMax(raw > 0 ? raw : 60);
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": o.aria, class: "mt-svg" });
    for (const f of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - f);
      svg("line", { x1: padL, x2: w - padR, y1: y, y2: y, class: f === 0 ? "mt-grid is-base" : "mt-grid" }, el);
      svg("text", { x: padL - 8, y: y + 3.5, "text-anchor": "end", class: "mt-axis" }, el).textContent = f === 0 ? "0" : fmt(max * f);
    }
    const bw = plotW / n, bwid = Math.max(2, Math.min(34, bw - Math.min(4, bw * 0.22))), idBase = `mtc${++uid}`;
    o.items.forEach((it, i) => {
      const cx = padL + i * bw + bw / 2, x = cx - bwid / 2, base = padT + plotH;
      const g = svg("g", { class: "mt-col" + (o.onSelect ? " mt-clickable" : "") }, el);
      svg("rect", { x: padL + i * bw, y: padT, width: bw, height: plotH, rx: 4, class: "mt-hit" }, g);
      const parts = (it.parts ?? []).filter((p) => p.value > 0);
      const heights = (parts.length ? parts : [{ value: it.value, color: "", name: "" }]).map((p) => (p.value / max) * plotH);
      const fullH = it.value > 0 ? Math.max(2, heights.reduce((a, b) => a + b, 0)) : 0;
      if (fullH > 0) {
        const clip = svg("clipPath", { id: `${idBase}-${i}` }, g);
        svg("rect", { x, y: base - fullH, width: bwid, height: fullH, rx: Math.min(4, bwid / 2) }, clip);
        const stack = svg("g", { "clip-path": `url(#${idBase}-${i})` }, g);
        let yy = base;
        (parts.length ? parts : [{ value: it.value, color: "", name: "" }]).forEach((pt, k) => {
          const hh = Math.max(heights[k], 1);
          yy -= hh;
          const rect = svg("rect", { x, y: yy, width: bwid, height: hh, class: pt.color ? "mt-bar-part" : "mt-bar-solid" }, stack);
          if (pt.color) rect.setAttribute("style", `fill:${pt.color}`);
        });
      } else svg("rect", { x: cx - Math.min(bwid, 10) / 2, y: base - 2, width: Math.min(bwid, 10), height: 2, rx: 1, class: "mt-bar-zero" }, g);
      if (it.ghost !== null && it.ghost !== undefined && it.ghost > 0) {
        const gy = base - (it.ghost / max) * plotH;
        svg("line", { x1: cx - bwid / 2 - 2, x2: cx + bwid / 2 + 2, y1: gy, y2: gy, class: "mt-ghost-tick" }, g);
      }
      attachTip(g, () => {
        const rows: TipRow[] = parts.slice().sort((a, b) => b.value - a.value).map((p) => ({ label: p.name || "Time", value: fmt(p.value), color: p.color || undefined }));
        if (parts.length > 1) rows.push({ label: "Total", value: fmt(it.value), strong: true });
        const avg = o.line?.[i];
        if (avg !== null && avg !== undefined) rows.push({ label: o.lineLabel ?? "Moving average", value: fmt(avg), muted: true });
        if (it.ghost !== null && it.ghost !== undefined) rows.push({ label: o.ghostLabel ?? "Previous period", value: it.ghost > 0 ? fmt(it.ghost) : "none", muted: true });
        return { title: it.heading ?? it.label, sub: it.value > 0 ? it.sub : "No activity", rows: it.value > 0 ? rows : rows.filter((r) => r.muted) };
      });
      if (o.onSelect) {
        g.setAttribute("tabindex", "0"); g.setAttribute("role", "button"); g.setAttribute("aria-label", it.title);
        g.addEventListener("click", () => o.onSelect!(it));
        g.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") { e.preventDefault(); o.onSelect!(it); } });
      } else g.setAttribute("aria-label", it.title);
    });
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
    o.items.forEach((it, i) => { if (i % every === 0) svg("text", { x: padL + i * bw + bw / 2, y: H - 6, "text-anchor": "middle", class: "mt-axis" }, el).textContent = it.label; });
    if (o.line) {
      let d = "";
      o.line.forEach((v, i) => { if (v === null) return; d += `${d ? "L" : "M"}${(padL + i * bw + bw / 2).toFixed(1)},${(padT + plotH - (v / max) * plotH).toFixed(1)} `; });
      if (d) { svg("path", { d, class: "mt-line-halo" }, el); svg("path", { d, class: "mt-line" }, el); }
    }
    return el;
  });
}

/** A tiny trend line for hero numbers: no axes, just the shape. Renders nothing when there is no shape to show. */
export function sparkline(parent: HTMLElement, values: number[], o: { height?: number; aria: string }): void {
  if (values.length < 2 || values.filter((v) => v > 0).length < 2) return;   // one active period is a point, not a trend
  const H = o.height ?? 44;
  responsive(parent, (w) => {
    const max = Math.max(...values), padY = 4, plotH = H - padY * 2, step = w / (values.length - 1);
    const pts = values.map((v, i) => [i * step, padY + plotH - (v / max) * plotH] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": o.aria, class: "mt-svg mt-spark" });
    svg("path", { d: `${line} L${w},${H} L0,${H} Z`, class: "mt-spark-area" }, el);
    svg("path", { d: line, class: "mt-spark-line" }, el);
    const last = pts[pts.length - 1];
    svg("circle", { cx: last[0] - 2, cy: last[1], r: 3, class: "mt-spark-dot" }, el);
    return el;
  });
}

export interface LineSeries { name: string; values: (number | null)[]; cls: "mt-line" | "mt-line-prev" }
export function lineChart(parent: HTMLElement, o: { series: LineSeries[]; xLabel: (i: number) => string; height?: number; aria: string; fmt?: (n: number) => string }): void {
  const fmt = o.fmt ?? formatDuration, H = o.height ?? 170;
  const n = Math.max(0, ...o.series.map((s) => s.values.length));
  if (!n) { parent.createDiv({ cls: "mt-empty", text: "No data in this range." }); return; }
  const legend = parent.createDiv({ cls: "mt-legend" });
  for (const s of o.series) { const li = legend.createSpan({ cls: "mt-legend-item" }); li.createSpan({ cls: `mt-swatch ${s.cls}` }); li.createSpan({ text: s.name }); }
  responsive(parent, (w) => {
    const padL = 44, padR = 8, padT = 12, padB = 24, plotW = w - padL - padR, plotH = H - padT - padB;
    const raw = Math.max(0, ...o.series.flatMap((s) => s.values.map((v) => v ?? 0)));
    const max = axisMax(raw > 0 ? raw : 60);
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": o.aria, class: "mt-svg mt-linechart" });
    for (const f of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - f);
      svg("line", { x1: padL, x2: w - padR, y1: y, y2: y, class: f === 0 ? "mt-grid is-base" : "mt-grid" }, el);
      svg("text", { x: padL - 8, y: y + 3.5, "text-anchor": "end", class: "mt-axis" }, el).textContent = f === 0 ? "0" : fmt(max * f);
    }
    const X = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW), Y = (v: number) => padT + plotH - (v / max) * plotH;
    for (const s of o.series) {
      let d = "";
      s.values.forEach((v, i) => { if (v !== null) d += `${d ? "L" : "M"}${X(i)},${Y(v)} `; });
      if (d) svg("path", { d, class: s.cls }, el);
    }
    // one invisible column per point: hovering anywhere near it shows every series' value for that position
    const colW = n === 1 ? plotW : plotW / (n - 1);
    for (let i = 0; i < n; i++) {
      const g = svg("g", { class: "mt-col" }, el);
      svg("rect", { x: X(i) - colW / 2, y: padT, width: colW, height: plotH, class: "mt-hit" }, g);
      attachTip(g, () => ({ title: o.xLabel(i), rows: o.series.filter((s) => s.values[i] !== null && s.values[i] !== undefined).map((s) => ({ label: s.name, value: fmt(s.values[i] as number), muted: s.cls === "mt-line-prev" })) }));
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 72))));
    for (let i = 0; i < n; i += every) svg("text", { x: X(i), y: H - 6, "text-anchor": "middle", class: "mt-axis" }, el).textContent = o.xLabel(i);
    return el;
  });
}

export interface HRow { label: string; value: number; text: string; share?: number | null; sub?: string; color?: string; onClick?: () => void }
/** Horizontal bars as plain HTML (selectable, screen-reader friendly). Bar length is relative to the largest row. */
export function hBars(parent: HTMLElement, rows: HRow[]): void {
  if (!rows.length) { parent.createDiv({ cls: "mt-empty", text: "No data in this range." }); return; }
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  const list = parent.createDiv({ cls: "mt-hbars" });
  for (const r of rows) {
    const row = list.createDiv({ cls: "mt-hrow" + (r.onClick ? " mt-clickable" : "") });
    if (r.onClick) { row.tabIndex = 0; row.setAttribute("role", "button"); row.addEventListener("click", r.onClick); row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); r.onClick!(); } }); }
    const lab = row.createSpan({ cls: "mt-hlabel" });
    if (r.color) lab.createSpan({ cls: "mt-dot-c" }).style.background = r.color;
    lab.createSpan({ text: r.label });
    const track = row.createDiv({ cls: "mt-htrack" });
    const fill = track.createDiv({ cls: "mt-hfill" });
    fill.style.width = `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`;
    if (r.color) fill.style.background = r.color;
    row.createSpan({ cls: "mt-hvalue", text: r.text });
    if (r.sub) row.createSpan({ cls: "mt-hsub", text: r.sub });
  }
}

export function progressBar(parent: HTMLElement, fraction: number, opts: { marker?: number; label: string; cls?: string; color?: string }): void {
  const track = parent.createDiv({ cls: "mt-progress", attr: { role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(Math.min(1, fraction) * 100)), "aria-label": opts.label } });
  const fill = track.createDiv({ cls: `mt-progress-fill ${opts.cls ?? ""}` });
  fill.style.width = `${Math.max(0, Math.min(100, fraction * 100))}%`;
  if (opts.color) fill.style.background = opts.color;
  if (opts.marker !== undefined) track.createDiv({ cls: "mt-progress-marker" }).style.left = `${Math.max(0, Math.min(100, opts.marker * 100))}%`;
}

/** Circular progress. `fraction` is clamped to 0..1 for the arc; the centre text can show the real percentage. */
export function ring(parent: HTMLElement, fraction: number, o: { size?: number; color: string; label: string; text?: string }): void {
  const size = o.size ?? 72, sw = Math.max(6, Math.round(size / 10)), r = (size - sw) / 2, C = 2 * Math.PI * r, c = size / 2;
  const el = svg("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": o.label, class: "mt-ring" });
  svg("circle", { cx: c, cy: c, r, "stroke-width": sw, class: "mt-ring-track" }, el);
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  if (f > 0) {
    const arc = svg("circle", { cx: c, cy: c, r, "stroke-width": sw, "stroke-dasharray": `${C * f} ${C}`, transform: `rotate(-90 ${c} ${c})`, "stroke-linecap": "round", class: "mt-ring-fill" }, el);
    arc.setAttribute("style", `stroke:${o.color}`);
  }
  if (o.text) svg("text", { x: c, y: c + size * 0.07, "text-anchor": "middle", class: "mt-ring-text", "font-size": Math.round(size * 0.24) }, el).textContent = o.text;
  parent.appendChild(el);
}

export function legend(parent: HTMLElement, entries: { name: string; color: string }[]): void {
  if (entries.length < 2) return;
  const l = parent.createDiv({ cls: "mt-legend" });
  for (const e of entries.slice(0, 8)) { const i = l.createSpan({ cls: "mt-legend-item" }); i.createSpan({ cls: "mt-dot-c" }).style.background = e.color; i.createSpan({ text: e.name }); }
}

/** Small dependency-free SVG/HTML charts. Everything is keyboard-focusable and has text alternatives. */
import { formatDuration } from "../core/duration";

const NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent?.appendChild(el);
  return el;
}

/** Redraws whenever the container is resized, so text stays at a readable size. */
function responsive(parent: HTMLElement, draw: (width: number) => SVGElement): void {
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

export interface BarPart { value: number; color: string; name: string }
export interface BarItem { label: string; value: number; key: string; title: string; parts?: BarPart[] }
export function barChart(parent: HTMLElement, o: { items: BarItem[]; line?: (number | null)[]; lineLabel?: string; height?: number; aria: string; fmt?: (n: number) => string; onSelect?: (item: BarItem) => void }): void {
  const fmt = o.fmt ?? formatDuration;
  const H = o.height ?? 150;
  if (!o.items.length) { parent.createDiv({ cls: "mt-empty", text: "No data in this range." }); return; }
  responsive(parent, (w) => {
    const padL = 46, padR = 4, padT = 8, padB = 20, plotW = w - padL - padR, plotH = H - padT - padB, n = o.items.length;
    const raw = Math.max(0, ...o.items.map((i) => i.value), ...(o.line ?? []).map((v) => v ?? 0));
    const max = axisMax(raw > 0 ? raw : 60);
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": o.aria, class: "mt-svg" });
    for (const f of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - f);
      svg("line", { x1: padL, x2: w - padR, y1: y, y2: y, class: "mt-grid" }, el);
      svg("text", { x: padL - 6, y: y + 4, "text-anchor": "end", class: "mt-axis" }, el).textContent = f === 0 ? "0" : fmt(max * f);
    }
    const bw = plotW / n, gap = Math.min(2, bw * 0.15);
    o.items.forEach((it, i) => {
      const x = padL + i * bw + gap / 2, bwid = Math.max(1, bw - gap);
      const cls = "mt-bar" + (o.onSelect ? " mt-clickable" : "");
      const g = svg("g", { class: cls }, el);
      let yy = padT + plotH;
      const parts = it.parts && it.parts.length ? it.parts : [{ value: it.value, color: "", name: "" }];
      parts.forEach((pt, k) => {
        const hh = Math.max((pt.value / max) * plotH, pt.value > 0 ? 1 : 0);
        yy -= hh;
        const rect = svg("rect", { x, y: yy, width: bwid, height: hh, rx: k === parts.length - 1 && bwid > 6 ? 2 : 0, class: pt.color ? "mt-bar-part" : "mt-bar-solid" }, g);
        if (pt.color) rect.setAttribute("style", `fill:${pt.color}`);
      });
      const r = g;
      svg("title", {}, r).textContent = it.title;
      if (o.onSelect) {
        r.setAttribute("tabindex", "0"); r.setAttribute("role", "button"); r.setAttribute("aria-label", it.title);
        r.addEventListener("click", () => o.onSelect!(it));
        r.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") { e.preventDefault(); o.onSelect!(it); } });
      }
    });
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
    o.items.forEach((it, i) => { if (i % every === 0) svg("text", { x: padL + i * bw + bw / 2, y: H - 5, "text-anchor": "middle", class: "mt-axis" }, el).textContent = it.label; });
    if (o.line) {
      let d = "";
      o.line.forEach((v, i) => { if (v === null) return; d += `${d ? "L" : "M"}${padL + i * bw + bw / 2},${padT + plotH - (v / max) * plotH} `; });
      if (d) { const p = svg("path", { d, class: "mt-line" }, el); svg("title", {}, p).textContent = o.lineLabel ?? "Moving average"; }
    }
    return el;
  });
}

export interface LineSeries { name: string; values: (number | null)[]; cls: "mt-line" | "mt-line-prev" }
export function lineChart(parent: HTMLElement, o: { series: LineSeries[]; xLabel: (i: number) => string; height?: number; aria: string; fmt?: (n: number) => string }): void {
  const fmt = o.fmt ?? formatDuration, H = o.height ?? 160;
  const n = Math.max(0, ...o.series.map((s) => s.values.length));
  if (!n) { parent.createDiv({ cls: "mt-empty", text: "No data in this range." }); return; }
  const legend = parent.createDiv({ cls: "mt-legend" });
  for (const s of o.series) { const li = legend.createSpan({ cls: "mt-legend-item" }); li.createSpan({ cls: `mt-swatch ${s.cls}` }); li.createSpan({ text: s.name }); }
  responsive(parent, (w) => {
    const padL = 46, padR = 8, padT = 8, padB = 20, plotW = w - padL - padR, plotH = H - padT - padB;
    const raw = Math.max(0, ...o.series.flatMap((s) => s.values.map((v) => v ?? 0)));
    const max = axisMax(raw > 0 ? raw : 60);
    const el = svg("svg", { viewBox: `0 0 ${w} ${H}`, width: "100%", height: H, role: "img", "aria-label": o.aria, class: "mt-svg" });
    for (const f of [0, 0.5, 1]) {
      const y = padT + plotH * (1 - f);
      svg("line", { x1: padL, x2: w - padR, y1: y, y2: y, class: "mt-grid" }, el);
      svg("text", { x: padL - 6, y: y + 4, "text-anchor": "end", class: "mt-axis" }, el).textContent = f === 0 ? "0" : fmt(max * f);
    }
    const X = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    for (const s of o.series) {
      let d = "";
      s.values.forEach((v, i) => { if (v !== null) d += `${d ? "L" : "M"}${X(i)},${padT + plotH - (v / max) * plotH} `; });
      if (d) svg("path", { d, class: s.cls }, el);
      if (n <= 45) s.values.forEach((v, i) => { if (v !== null) { const c = svg("circle", { cx: X(i), cy: padT + plotH - (v / max) * plotH, r: 2.5, class: `mt-dot ${s.cls}` }, el); svg("title", {}, c).textContent = `${s.name} · ${o.xLabel(i)}: ${fmt(v)}`; } });
    }
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 64))));
    for (let i = 0; i < n; i += every) svg("text", { x: X(i), y: H - 5, "text-anchor": "middle", class: "mt-axis" }, el).textContent = o.xLabel(i);
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

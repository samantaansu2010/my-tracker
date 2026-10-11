/**
 * One floating tooltip shared by every chart. Native SVG <title> tooltips are slow, unstyled and invisible on touch;
 * this card follows the pointer, appears on keyboard focus too, and uses the theme's own colours.
 */
export interface TipRow { label: string; value?: string; color?: string; muted?: boolean; strong?: boolean }
export interface TipContent { title?: string; sub?: string; rows?: TipRow[]; foot?: string }

let el: HTMLElement | null = null;

function host(doc: Document): HTMLElement {
  if (el && el.ownerDocument === doc && el.isConnected) return el;
  el = doc.body.createDiv({ cls: "mt-tip", attr: { role: "tooltip" } });
  return el;
}

function fill(t: HTMLElement, c: TipContent): void {
  t.empty();
  if (c.title) t.createDiv({ cls: "mt-tip-title", text: c.title });
  if (c.sub) t.createDiv({ cls: "mt-tip-sub", text: c.sub });
  for (const r of c.rows ?? []) {
    const row = t.createDiv({ cls: "mt-tip-row" + (r.muted ? " is-muted" : "") + (r.strong ? " is-strong" : "") });
    const lab = row.createSpan({ cls: "mt-tip-label" });
    if (r.color) lab.createSpan({ cls: "mt-tip-dot" }).style.background = r.color;
    lab.createSpan({ text: r.label });
    if (r.value !== undefined) row.createSpan({ cls: "mt-tip-value", text: r.value });
  }
  if (c.foot) t.createDiv({ cls: "mt-tip-foot", text: c.foot });
}

export function showTip(doc: Document, c: TipContent, x: number, y: number): void {
  const t = host(doc);
  fill(t, c);
  t.addClass("is-open");
  const win = doc.defaultView ?? window, pad = 10, off = 14;
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + off, top = y + off;
  if (left + w + pad > win.innerWidth) left = Math.max(pad, x - off - w);
  if (top + h + pad > win.innerHeight) top = Math.max(pad, y - off - h);
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
}

export function hideTip(): void { el?.removeClass("is-open"); }

/** Shows `content()` while the pointer is over `target` or the keyboard focus is on it. Return null to show nothing. */
export function attachTip(target: Element, content: () => TipContent | null): void {
  const show = (x: number, y: number) => { const c = content(); if (c) showTip(target.ownerDocument, c, x, y); else hideTip(); };
  target.addEventListener("pointerenter", (e) => { const p = e as PointerEvent; if (p.pointerType !== "touch") show(p.clientX, p.clientY); });
  target.addEventListener("pointermove", (e) => { const p = e as PointerEvent; if (p.pointerType !== "touch") show(p.clientX, p.clientY); });
  target.addEventListener("pointerleave", hideTip);
  target.addEventListener("focus", () => { const r = target.getBoundingClientRect(); show(r.left + r.width / 2, r.top); });
  target.addEventListener("blur", hideTip);
}

import { Modal, Notice } from "obsidian";
import type { TrackerHost } from "../host";
import type { TrackerEvent } from "../core/types";
import { parseEntry, type ParsedEntry } from "../core/parser";
import { formatDuration, parseDuration } from "../core/duration";
import { formatLocalIso } from "../core/dates";
import { canonicalizePath, childNames, ensurePath, suggest, type Ranked } from "../core/hierarchy";
import { normalize } from "../core/text";

type Field = "path" | "duration" | "result" | "kind" | "tags" | "notes" | "time" | "planned" | "scores";

/** Fast entry: one line of text with live preview + autocomplete, plus an optional detailed form. */
export class TrackModal extends Modal {
  private parsed: ParsedEntry | null = null;
  private dirty = new Set<Field>();
  private quick!: HTMLInputElement; private suggestEl!: HTMLElement; private previewEl!: HTMLElement; private msgEl!: HTMLElement;
  private f: Record<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement> = {};
  private scoreEls = new Map<string, HTMLInputElement>();
  private suggestions: Ranked[] = []; private sel = -1; private tokensReplaced = 0;
  private saving = false;

  constructor(private host: TrackerHost, private editing?: TrackerEvent) { super(host.app); }

  onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("mt-track");
    contentEl.createEl("h3", { text: this.editing ? "Edit activity" : "Track activity" });
    if (!this.editing) {
      this.quick = contentEl.createEl("input", { cls: "mt-quick", attr: { type: "text", placeholder: this.host.settings.dashboard.mode === "simple" ? "What did you do?  e.g. Math 45m" : "Math Algebra 45m A   ·  #tag  ·  @14:30  ·  yesterday  ·  - notes", "aria-label": "Quick entry", autocomplete: "off", spellcheck: "false" } });
      this.suggestEl = contentEl.createDiv({ cls: "mt-suggest", attr: { role: "listbox" } });
      this.quick.addEventListener("input", () => { this.reparse(); this.updateSuggest(); });
      this.quick.addEventListener("keydown", (e) => this.onQuickKey(e));
      window.setTimeout(() => this.quick.focus(), 0);
    }
    this.previewEl = contentEl.createDiv({ cls: "mt-preview", attr: { "aria-live": "polite" } });
    this.buildForm(contentEl);
    this.msgEl = contentEl.createDiv({ cls: "mt-msg", attr: { role: "alert" } });
    const btns = contentEl.createDiv({ cls: "mt-buttons" });
    btns.createEl("button", { text: this.editing ? "Save changes" : "Save", cls: "mod-cta" }).addEventListener("click", () => void this.save(false));
    if (!this.editing) btns.createEl("button", { text: "Save & add another" }).addEventListener("click", () => void this.save(true));
    btns.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    contentEl.createDiv({ cls: "mt-muted mt-hint", text: this.editing || this.host.settings.dashboard.mode === "simple" ? "" : "Enter saves · Shift+Enter saves and keeps the window open · Tab accepts a suggestion" });
    contentEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.save(false); } });
    if (this.editing) this.prefill(this.editing);
    this.refresh();
  }
  onClose(): void { this.contentEl.empty(); }

  // ---------- form ----------
  private buildForm(root: HTMLElement): void {
    const s = this.host.settings;
    const det = root.createEl("details", { cls: "mt-details" });
    if (this.editing) det.open = true;
    det.createEl("summary", { text: "Detailed form" });
    const grid = det.createDiv({ cls: "mt-form" });
    const row = (label: string, make: (cell: HTMLElement) => HTMLElement) => { const cell = grid.createDiv({ cls: "mt-field" }); cell.createEl("label", { text: label }); return make(cell); };
    const names = ["Category", "Subject", "Sub-subject", "Topic"];
    names.forEach((n, i) => {
      const id = `mt-dl-${i}-${Math.random().toString(36).slice(2, 7)}`;
      const input = row(n, (c) => c.createEl("input", { attr: { type: "text", list: id, autocomplete: "off" } })) as HTMLInputElement;
      const dl = input.parentElement!.createEl("datalist", { attr: { id } });
      const fill = () => { dl.empty(); const prefix = this.pathFromFields().slice(0, i); if (prefix.length === i) for (const c of childNames(s.tree, prefix)) dl.createEl("option", { attr: { value: c } }); };
      input.addEventListener("focus", fill);
      input.addEventListener("input", () => { this.dirty.add("path"); fill(); this.refresh(); });
      this.f[`p${i}`] = input;
    });
    const dur = row("Duration", (c) => c.createEl("input", { attr: { type: "text", placeholder: "1h 20m, 90m, 1:30" } })) as HTMLInputElement;
    dur.addEventListener("input", () => { this.dirty.add("duration"); this.refresh(); }); this.f.duration = dur;
    const res = row("Result", (c) => c.createEl("select")) as HTMLSelectElement;
    res.createEl("option", { text: "—", attr: { value: "" } });
    for (const r of s.resultScale) res.createEl("option", { text: r.label, attr: { value: r.label } });
    res.addEventListener("change", () => { this.dirty.add("result"); this.refresh(); }); this.f.result = res;
    const kind = row("Type", (c) => c.createEl("select")) as HTMLSelectElement;
    kind.createEl("option", { text: "—", attr: { value: "" } });
    for (const k of s.kinds) kind.createEl("option", { text: k, attr: { value: k } });
    kind.addEventListener("change", () => { this.dirty.add("kind"); this.refresh(); }); this.f.kind = kind;
    const when = row("Date & time", (c) => c.createEl("input", { attr: { type: "datetime-local" } })) as HTMLInputElement;
    when.addEventListener("input", () => { this.dirty.add("time"); this.refresh(); }); this.f.time = when;
    const plan = row("Planned (optional)", (c) => c.createEl("input", { attr: { type: "text", placeholder: "e.g. 1h" } })) as HTMLInputElement;
    plan.addEventListener("input", () => { this.dirty.add("planned"); this.refresh(); }); this.f.planned = plan;
    const tags = row("Tags", (c) => c.createEl("input", { attr: { type: "text", placeholder: "exam-preparation, revision" } })) as HTMLInputElement;
    tags.addEventListener("input", () => { this.dirty.add("tags"); this.refresh(); }); this.f.tags = tags;
    for (const m of s.measurements) {
      const el = row(`${m.name} (${m.min}–${m.max}${m.unit === "%" ? "%" : ""})`, (c) => c.createEl("input", { attr: { type: "number", min: String(m.min), max: String(m.max), step: "any" } })) as HTMLInputElement;
      el.addEventListener("input", () => { this.dirty.add("scores"); this.refresh(); });
      this.scoreEls.set(m.key, el);
    }
    const notes = grid.createDiv({ cls: "mt-field mt-wide" });
    notes.createEl("label", { text: "Notes" });
    const ta = notes.createEl("textarea", { attr: { rows: "2" } });
    ta.addEventListener("input", () => { this.dirty.add("notes"); this.refresh(); }); this.f.notes = ta;
  }

  private prefill(e: TrackerEvent): void {
    const set = (k: string, v: string) => { (this.f[k] as HTMLInputElement).value = v; };
    for (let i = 0; i < 4; i++) set(`p${i}`, i < 3 ? e.path[i] ?? "" : e.path.slice(3).join(" > "));
    set("duration", formatDuration(e.durationMinutes)); set("result", e.result ?? ""); set("kind", e.kind ?? "");
    set("time", e.timestamp.slice(0, 16)); set("planned", e.plannedMinutes ? formatDuration(e.plannedMinutes) : "");
    set("tags", e.tags.join(", ")); set("notes", e.notes);
    for (const [k, el] of this.scoreEls) el.value = e.scores?.[k] !== undefined ? String(e.scores[k]) : "";
    (["path", "duration", "result", "kind", "tags", "notes", "time", "planned", "scores"] as Field[]).forEach((d) => this.dirty.add(d));
    // Keep exact minutes if the user does not touch the duration box (formatDuration rounds for display).
    this.exactDuration = e.durationMinutes; this.exactPlanned = e.plannedMinutes;
  }
  private exactDuration?: number; private exactPlanned?: number;

  private pathFromFields(): string[] {
    const parts = [0, 1, 2].map((i) => (this.f[`p${i}`] as HTMLInputElement | undefined)?.value.trim() ?? "");
    const rest = ((this.f.p3 as HTMLInputElement | undefined)?.value ?? "").split(/\s*[>›]\s*/).map((x) => x.trim());
    const all = [...parts, ...rest];
    while (all.length && !all[all.length - 1]) all.pop();
    const firstEmpty = all.findIndex((x) => !x);
    return firstEmpty >= 0 ? all.slice(0, firstEmpty) : all;
  }

  // ---------- parsing & draft ----------
  private reparse(): void {
    this.parsed = this.quick.value.trim() ? parseEntry(this.quick.value, { tree: this.host.settings.tree, resultScale: this.host.settings.resultScale, kinds: this.host.settings.kinds, measurements: this.host.settings.measurements, now: this.host.now(), defaultCategory: this.host.settings.defaultCategory, defaultDurationUnit: this.host.settings.defaultDurationUnit }) : null;
    this.syncForm();
    this.refresh();
  }
  private syncForm(): void {
    const p = this.parsed; if (!p) return;
    const put = (k: string, v: string, field: Field) => { if (!this.dirty.has(field)) (this.f[k] as HTMLInputElement).value = v; };
    for (let i = 0; i < 4; i++) put(`p${i}`, i < 3 ? p.path[i] ?? "" : p.path.slice(3).join(" > "), "path");
    put("duration", p.durationMinutes ? formatDuration(p.durationMinutes) : "", "duration");
    put("result", p.result ?? "", "result"); put("kind", p.kind ?? "", "kind");
    put("time", p.timestamp.slice(0, 16), "time"); put("tags", p.tags.join(", "), "tags"); put("notes", p.notes, "notes");
    put("planned", p.plannedMinutes ? formatDuration(p.plannedMinutes) : "", "planned");
    if (!this.dirty.has("scores")) for (const [k, el] of this.scoreEls) el.value = p.scores[k] !== undefined ? String(p.scores[k]) : "";
  }

  private draft() {
    const s = this.host.settings, p = this.parsed;
    const errors: string[] = [], warnings = [...(p?.warnings ?? [])];
    const path = this.dirty.has("path") ? this.pathFromFields() : p?.path ?? [];
    let duration: number | null = p?.durationMinutes ?? null;
    if (this.dirty.has("duration")) {
      const raw = (this.f.duration as HTMLInputElement).value.trim();
      duration = this.editing && raw === formatDuration(this.exactDuration) ? this.exactDuration! : parseDuration(raw, s.defaultDurationUnit);
      if (duration === null) errors.push("Duration not understood (try 45m, 1h 20m or 1:30)");
    } else if (!this.editing) errors.push(...(p?.errors.filter((e) => /duration/i.test(e)) ?? (p ? [] : ["Type something like “Math Algebra 45m A”"])));
    if (duration !== null && duration > 1440) { errors.push("Duration cannot exceed 24 hours"); duration = null; }
    if (!path.length) { if (p || this.editing) errors.push("Missing subject"); }
    let timestamp = p?.timestamp ?? formatLocalIso(this.host.now());
    if (this.dirty.has("time")) {
      const v = (this.f.time as HTMLInputElement).value;
      const d = v ? new Date(v) : null;
      if (d && !Number.isNaN(d.getTime())) timestamp = this.editing && v === this.editing.timestamp.slice(0, 16) ? this.editing.timestamp : formatLocalIso(d);
      else errors.push("Invalid date/time");
    }
    const result = this.dirty.has("result") ? (this.f.result as HTMLSelectElement).value || undefined : p?.result;
    const kind = this.dirty.has("kind") ? (this.f.kind as HTMLSelectElement).value || undefined : p?.kind;
    const tags = this.dirty.has("tags") ? (this.f.tags as HTMLInputElement).value.split(/[,\s]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter(Boolean) : p?.tags ?? [];
    const notes = this.dirty.has("notes") ? (this.f.notes as HTMLTextAreaElement).value : p?.notes ?? "";
    let planned = p?.plannedMinutes;
    if (this.dirty.has("planned")) {
      const raw = (this.f.planned as HTMLInputElement).value.trim();
      planned = !raw ? undefined : this.editing && raw === formatDuration(this.exactPlanned) ? this.exactPlanned : parseDuration(raw, s.defaultDurationUnit) ?? undefined;
      if (raw && planned === undefined) errors.push("Planned time not understood");
    }
    let scores: Record<string, number> | undefined = p && Object.keys(p.scores).length ? p.scores : undefined;
    if (this.dirty.has("scores")) {
      scores = {};
      for (const m of s.measurements) {
        const raw = this.scoreEls.get(m.key)!.value.trim(); if (!raw) continue;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < m.min || v > m.max) errors.push(`${m.name} must be between ${m.min} and ${m.max}`); else scores[m.key] = v;
      }
      if (!Object.keys(scores).length) scores = undefined;
    }
    return { path, duration, timestamp, result, kind, tags, notes, planned, scores, errors, warnings, existingDepth: this.dirty.has("path") ? this.countExisting(path) : p?.existingDepth ?? 0 };
  }
  private countExisting(path: string[]): number {
    const c = canonicalizePath(this.host.settings.tree, path);
    const probe = this.host.settings.tree; let level = probe, n = 0;
    for (const seg of c) { const hit = level.find((x) => normalize(x.name) === normalize(seg)); if (!hit) break; n++; level = hit.children; }
    return n;
  }

  private refresh(): void {
    const d = this.draft(), el = this.previewEl; el.empty();
    if (!this.parsed && !this.editing) { el.createDiv({ cls: "mt-muted", text: this.host.settings.dashboard.mode === "simple" ? "Subject and time, like “Reading 30m”" : "Subject, duration, optional result. Example: Math Algebra 45m A" }); return; }
    const crumbs = el.createDiv({ cls: "mt-crumbs" });
    if (d.path.length) d.path.forEach((seg, i) => { if (i) crumbs.createSpan({ text: "›", cls: "mt-sep" }); const c = crumbs.createSpan({ cls: "mt-chip", text: seg }); if (i >= d.existingDepth) c.createSpan({ cls: "mt-new", text: " new" }); });
    else crumbs.createSpan({ cls: "mt-muted", text: "No subject yet" });
    const chips = el.createDiv({ cls: "mt-chips" });
    const chip = (t: string) => chips.createSpan({ cls: "mt-chip", text: t });
    if (d.duration) chip(formatDuration(d.duration));
    if (d.result) chip(`Result ${d.result}`);
    if (d.kind) chip(d.kind);
    chip(d.timestamp.slice(0, 16).replace("T", " "));
    if (d.planned) chip(`Planned ${formatDuration(d.planned)}`);
    for (const t of d.tags) chip(`#${t}`);
    for (const [k, v] of Object.entries(d.scores ?? {})) chip(`${this.host.settings.measurements.find((m) => m.key === k)?.name ?? k}: ${v}`);
    if (d.notes) el.createDiv({ cls: "mt-muted", text: d.notes });
    for (const w of d.warnings) el.createDiv({ cls: "mt-warn", text: w });
    for (const e of d.errors) el.createDiv({ cls: "mt-error", text: e });
  }

  // ---------- autocomplete ----------
  private updateSuggest(): void {
    this.suggestions = []; this.sel = -1; this.suggestEl.empty();
    const v = this.quick.value;
    if (!v.trim() || /\s$/.test(v)) return;
    const toks = v.split(/\s+/);
    for (let n = Math.min(3, toks.length); n >= 1; n--) {
      const frag = toks.slice(-n).join(" ");
      if (/^[#@]|[:=]|^\d/.test(toks[toks.length - n])) continue;
      const r = suggest(frag, this.host.settings.tree, 6);
      if (r.length && !(r[0].score >= 98 && normalize(frag) === normalize(r[0].entry.node.name))) { this.suggestions = r; this.tokensReplaced = n; break; }
    }
    this.suggestions.forEach((r, i) => {
      const item = this.suggestEl.createDiv({ cls: "mt-suggest-item", attr: { role: "option", id: `mt-sg-${i}` } });
      item.createSpan({ cls: "mt-suggest-name", text: r.entry.node.name });
      item.createSpan({ cls: "mt-muted", text: r.entry.path.slice(0, -1).join(" › ") });
      item.addEventListener("mousedown", (e) => { e.preventDefault(); this.accept(i); });
    });
  }
  private highlight(): void { Array.from(this.suggestEl.children).forEach((c, i) => (c as HTMLElement).toggleClass("is-selected", i === this.sel)); }
  private accept(i: number): void {
    const r = this.suggestions[i]; if (!r) return;
    const toks = this.quick.value.split(/\s+/);
    toks.splice(toks.length - this.tokensReplaced, this.tokensReplaced, r.entry.node.name);
    this.quick.value = toks.join(" ") + " ";
    this.reparse(); this.updateSuggest(); this.quick.focus();
  }
  private onQuickKey(e: KeyboardEvent): void {
    const n = this.suggestions.length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); this.sel = (this.sel + 1) % n; this.highlight(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); this.sel = (this.sel - 1 + n) % n; this.highlight(); }
    else if (e.key === "Tab" && n && !e.shiftKey) { e.preventDefault(); this.accept(this.sel >= 0 ? this.sel : 0); }
    else if (e.key === "Enter") { e.preventDefault(); if (this.sel >= 0 && n) this.accept(this.sel); else void this.save(e.shiftKey); }
    else if (e.key === "Escape" && n) { e.stopPropagation(); this.suggestions = []; this.suggestEl.empty(); }
  }

  // ---------- saving ----------
  private showMsg(text: string, withForce = false): void {
    this.msgEl.empty(); if (!text) return;
    this.msgEl.createSpan({ cls: "mt-error", text });
    if (withForce) this.msgEl.createEl("button", { text: "Save anyway" }).addEventListener("click", () => void this.save(false, true));
  }
  private async save(another: boolean, force = false): Promise<void> {
    if (this.saving) return;
    const d = this.draft();
    if (d.errors.length || d.duration === null || !d.path.length) { this.showMsg(d.errors[0] ?? "Fill in a subject and a duration"); return; }
    this.saving = true;
    try {
      const tree = this.host.settings.tree;
      const path = canonicalizePath(tree, d.path);
      const input = { timestamp: d.timestamp, path, durationMinutes: d.duration, kind: d.kind, result: d.result, scores: d.scores, plannedMinutes: d.planned, tags: d.tags, notes: d.notes, source: this.editing?.source ?? "manual" };
      const res = this.editing ? await this.host.store.update(this.editing.id, input) : await this.host.store.add(input, { allowDuplicate: force });
      if (!res.ok) {
        if (res.reason === "duplicate") this.showMsg("An identical event already exists (same time, subject, duration, result and notes).", true);
        else this.showMsg(`Could not save: ${res.errors.join("; ")}`);
        return;
      }
      if (ensurePath(tree, path).length) await this.host.saveSettings();
      const frag = createFragment();
      frag.createSpan({ text: `Saved: ${path.join(" › ")} · ${formatDuration(d.duration)}  ` });
      frag.createEl("button", { text: "Undo" }).addEventListener("click", () => void this.host.undoLast());
      new Notice(frag, 6000);
      this.showMsg("");
      if (another && !this.editing) { this.quick.value = ""; this.parsed = null; this.dirty.clear(); this.syncClear(); this.updateSuggest(); this.refresh(); this.quick.focus(); }
      else this.close();
    } finally { this.saving = false; }
  }
  private syncClear(): void {
    for (const el of Object.values(this.f)) el.value = "";
    for (const el of this.scoreEls.values()) el.value = "";
  }
}

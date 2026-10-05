import { FuzzySuggestModal, Modal, Notice, Setting } from "obsidian";
import type { TrackerHost } from "../host";
import { parseQuestion } from "../core/queryText";
import { resolveRange, previousRange, formatDateKey, RANGE_LABELS, type DateRange } from "../core/dates";
import { compareStats } from "../core/compare";
import { computeStats, filterByPath } from "../core/stats";
import { formatDuration, formatPercent, formatPercentChange, formatSignedDuration } from "../core/duration";
import { pathLabel } from "../core/hierarchy";
import { csvToRawEvents, parseBundle } from "../core/importExport";
import type { ImportReport } from "../core/store";
import type { RangeId } from "../core/types";

/** "How much Math did I do in the last 14 days?" — answered locally. */
export class QueryModal extends Modal {
  constructor(private host: TrackerHost) { super(host.app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Ask your tracker" });
    const input = contentEl.createEl("input", { cls: "mt-quick", attr: { type: "text", placeholder: "How much Mathematics > Algebra did I do this month?  ·  Compare English this month with last month", "aria-label": "Question" } });
    const out = contentEl.createDiv({ cls: "mt-answer", attr: { "aria-live": "polite" } });
    const run = () => { out.empty(); if (input.value.trim()) this.answer(input.value, out); };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    window.setTimeout(() => input.focus(), 0);
  }
  onClose(): void { this.contentEl.empty(); }

  private answer(q: string, out: HTMLElement): void {
    const h = this.host, s = h.settings, today = h.today();
    const p = parseQuestion(q, s.tree);
    const range = resolveRange(p.range, today, h.resolveOpts());
    const events = filterByPath(h.store.list(), p.path);
    const name = p.path.length ? pathLabel(p.path) : "All activity";
    if (p.unresolved && !p.path.length) out.createDiv({ cls: "mt-warn", text: `I couldn't match “${p.unresolved}” to a subject, so this shows all activity.` });
    const fmt = (r: DateRange) => `${formatDateKey(r.start, s.dateFormat)} → ${formatDateKey(r.end > today ? today : r.end, s.dateFormat)}`;
    const cur = computeStats(events, range, today);
    out.createEl("h4", { text: `${name} · ${range.label}` });
    out.createDiv({ cls: "mt-big", text: formatDuration(cur.totalMinutes) });
    out.createDiv({ cls: "mt-muted", text: `${fmt(range)} · ${cur.sessions} sessions · ${cur.activeDays}/${cur.calendarDays} active days (${formatPercent(cur.consistency)}) · ${formatDuration(cur.avgPerActiveDay)} per active day` });
    if (p.compare) {
      const prev = previousRange(range, today, true);
      const c = compareStats(cur, computeStats(events, prev, today));
      out.createEl("h4", { text: `vs ${prev.label}` });
      out.createDiv({ text: `Previous: ${formatDuration(c.minutes.previous)} (${fmt(prev)})` });
      out.createDiv({ text: `Difference: ${formatSignedDuration(c.minutes.diff ?? 0)} · Change: ${c.minutes.kind === "pct" ? formatPercentChange(c.minutes.pct) : c.minutes.kind === "new" ? "new activity (previous was zero)" : "n/a"}` });
      out.createDiv({ text: `Sessions ${cur.sessions} vs ${c.sessions.previous} · Active days ${cur.activeDays} vs ${c.activeDays.previous} · Avg/day ${formatDuration(cur.avgPerCalendarDay)} vs ${formatDuration(c.avgPerCalendarDay.previous)}` });
    }
    out.createEl("button", { text: "Show events" }).addEventListener("click", () => h.openDrill(`${name} · ${range.label}`, () => filterByPath(h.store.list(), p.path).filter((e) => e.date >= range.start && e.date <= (range.end > today ? today : range.end))));
  }
}

const REPORT_RANGES: RangeId[] = ["thisWeek", "prevWeek", "thisMonth", "prevMonth", "thisYear", "prevYear"];
export class RangePicker extends FuzzySuggestModal<RangeId> {
  constructor(host: TrackerHost, private onPick: (id: RangeId) => void) { super(host.app); this.setPlaceholder("Report period"); }
  getItems(): RangeId[] { return REPORT_RANGES; }
  getItemText(id: RangeId): string { return RANGE_LABELS[id]; }
  onChooseItem(id: RangeId): void { this.onPick(id); }
}

export class ImportModal extends Modal {
  constructor(private host: TrackerHost, private onDone: (rep: ImportReport, source: string) => Promise<void>) { super(host.app); }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Import events" });
    contentEl.createEl("p", { text: "Choose a My Tracker JSON export/backup, or a CSV with columns such as date, time, category, subject, duration, result, notes. Existing events are never overwritten; duplicates are skipped and unreadable rows are saved to a rejects file." });
    const input = contentEl.createEl("input", { attr: { type: "file", accept: ".json,.csv,application/json,text/csv" } });
    const out = contentEl.createDiv({ cls: "mt-msg" });
    new Setting(contentEl).addButton((b) => b.setButtonText("Import").setCta().onClick(async () => {
      const file = input.files?.[0];
      if (!file) { out.setText("Choose a file first."); return; }
      b.setDisabled(true);
      try {
        const text = await file.text();
        let rows: unknown[];
        if (/\.csv$/i.test(file.name)) rows = csvToRawEvents(text, this.host.settings.defaultDurationUnit);
        else { const p = parseBundle(text); if (p.error) { out.setText(p.error); b.setDisabled(false); return; } rows = p.events; }
        const rep = await this.host.store.addMany(rows);
        await this.onDone(rep, file.name);
        out.setText(`Added ${rep.added}, skipped ${rep.duplicates} duplicates, ${rep.conflicts} id conflicts, ${rep.invalid.length} unreadable.`);
      } catch (e) { out.setText(`Import failed: ${String(e)}`); new Notice("Import failed — no data was changed beyond what's reported."); }
      b.setDisabled(false);
    })).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
  }
  onClose(): void { this.contentEl.empty(); }
}

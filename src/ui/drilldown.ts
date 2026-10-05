import { Modal, Notice } from "obsidian";
import type { TrackerHost } from "../host";
import type { TrackerEvent } from "../core/types";
import { formatDuration } from "../core/duration";
import { formatDateKey, formatTime } from "../core/dates";
import { pathLabel } from "../core/hierarchy";

/** Lists the raw events behind any number on the dashboard, with edit/delete. Re-queries live as data changes. */
export class DrillModal extends Modal {
  private off?: () => void;
  private pendingDelete: string | null = null;
  constructor(private host: TrackerHost, private title: string, private query: () => TrackerEvent[]) { super(host.app); }

  onOpen(): void {
    this.modalEl.addClass("mt-drill");
    this.off = this.host.store.onChange(() => this.render());
    this.render();
  }
  onClose(): void { this.off?.(); this.contentEl.empty(); }

  private render(): void {
    const el = this.contentEl; el.empty();
    const events = [...this.query()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const total = events.reduce((a, e) => a + e.durationMinutes, 0);
    el.createEl("h3", { text: this.title });
    el.createDiv({ cls: "mt-muted", text: `${events.length} event${events.length === 1 ? "" : "s"} · ${formatDuration(total)}` });
    if (!events.length) { el.createDiv({ cls: "mt-empty", text: "No events." }); return; }
    const s = this.host.settings;
    const list = el.createDiv({ cls: "mt-events" });
    for (const e of events.slice(0, 500)) {
      const row = list.createDiv({ cls: "mt-event" });
      const main = row.createDiv({ cls: "mt-event-main" });
      main.createDiv({ cls: "mt-event-title", text: `${pathLabel(e.path)} · ${formatDuration(e.durationMinutes)}` });
      const meta = [formatDateKey(e.date, s.dateFormat), e.source === "activitywatch" ? "ActivityWatch daily total" : formatTime(e.timestamp, s.timeFormat), e.kind, e.result && `Result ${e.result}`, e.tags.length ? e.tags.map((t) => `#${t}`).join(" ") : ""].filter(Boolean).join(" · ");
      main.createDiv({ cls: "mt-muted", text: meta });
      if (e.notes) main.createDiv({ cls: "mt-event-notes", text: e.notes });
      const actions = row.createDiv({ cls: "mt-event-actions" });
      if (e.source !== "activitywatch") actions.createEl("button", { text: "Edit", attr: { "aria-label": `Edit event ${pathLabel(e.path)}` } }).addEventListener("click", () => this.host.openTrack(e));
      const del = actions.createEl("button", { text: this.pendingDelete === e.id ? "Confirm delete" : "Delete", cls: this.pendingDelete === e.id ? "mod-warning" : "" });
      del.addEventListener("click", async () => {
        if (this.pendingDelete !== e.id) { this.pendingDelete = e.id; this.render(); return; }
        this.pendingDelete = null;
        const r = await this.host.store.remove(e.id);
        new Notice(r.ok ? "Event deleted. Use “My Tracker: Undo last change” to restore it." : `Could not delete: ${r.errors.join("; ")}`);
      });
    }
    if (events.length > 500) el.createDiv({ cls: "mt-muted", text: `Showing the most recent 500 of ${events.length}.` });
  }
}

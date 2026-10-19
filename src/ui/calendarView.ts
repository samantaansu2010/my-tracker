import { ItemView, setIcon, type WorkspaceLeaf } from "obsidian";
import type { TrackerHost } from "../host";
import type { TrackerEvent } from "../core/types";
import { addDays, formatDateKey, formatShortDate, isDateKey, toDateKey } from "../core/dates";
import { isScheduled } from "../core/schedule";

export const CALENDAR_VIEW_TYPE = "my-tracker-calendar";
type Mode = "day" | "week" | "month" | "list";
type Filter = "all" | "scheduled" | "completed";
const MODES: Mode[] = ["day", "week", "month", "list"];

export class CalendarView extends ItemView {
  private date: string;
  private mode: Mode = "day";
  private filter: Filter = "all";

  constructor(leaf: WorkspaceLeaf, private host: TrackerHost) {
    super(leaf);
    this.date = host.today();
  }

  getViewType(): string { return CALENDAR_VIEW_TYPE; }
  getDisplayText(): string { return "My Tracker Calendar"; }
  getIcon(): string { return "calendar-days"; }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("mt-calendar");
    this.render();
  }

  getState(): Record<string, unknown> {
    return { ...super.getState(), date: this.date, mode: this.mode, filter: this.filter };
  }

  async setState(state: unknown, result: import("obsidian").ViewStateResult): Promise<void> {
    const s = state as { date?: unknown; mode?: unknown; filter?: unknown } | null;
    if (typeof s?.date === "string" && isDateKey(s.date)) this.date = s.date;
    if (typeof s?.mode === "string" && MODES.includes(s.mode as Mode)) this.mode = s.mode as Mode;
    if (s?.filter === "all" || s?.filter === "scheduled" || s?.filter === "completed") this.filter = s.filter;
    await super.setState(state, result);
    this.render();
  }

  refresh(): void { this.render(); }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const bar = root.createDiv({ cls: "mt-cal-bar" });
    const nav = bar.createDiv({ cls: "mt-cal-nav" });
    const step = (label: string, delta: number) => {
      const b = nav.createEl("button", { text: label, attr: { type: "button" } });
      b.addEventListener("click", () => {
        const amount = this.mode === "week" ? 7 : this.mode === "month" ? 30 : 1;
        this.date = addDays(this.date, delta * amount);
        this.render();
      });
    };
    step("‹", -1);
    nav.createEl("button", { text: "Today", attr: { type: "button" } }).addEventListener("click", () => { this.date = this.host.today(); this.render(); });
    step("›", 1);
    const title = bar.createEl("h2", { text: this.mode === "day" ? formatDateKey(this.date, this.host.settings.dateFormat) : this.mode === "week" ? "Week of " + formatShortDate(this.date, this.host.settings.dateFormat) : this.mode === "month" ? this.date.slice(0, 7) : "All records" });
    title.addClass("mt-cal-title");
    const jump = bar.createEl("input", { attr: { type: "date", "aria-label": "Go to date" } });
    jump.value = this.date;
    jump.addEventListener("change", () => { if (isDateKey(jump.value)) { this.date = jump.value; this.render(); } });
    const modes = bar.createDiv({ cls: "mt-cal-modes" });
    for (const mode of MODES) {
      const b = modes.createEl("button", { text: mode[0].toUpperCase() + mode.slice(1), attr: { type: "button", "aria-pressed": String(this.mode === mode) } });
      if (mode === this.mode) b.addClass("is-active");
      b.addEventListener("click", () => { this.mode = mode; this.render(); });
    }
    const actions = bar.createDiv({ cls: "mt-cal-actions" });
    actions.createEl("button", { text: "Schedule task", attr: { type: "button" } }).addEventListener("click", () => this.host.openTrack(undefined, { date: this.date, start: "09:00", durationMinutes: 30, status: "scheduled" }));
    actions.createEl("button", { text: "Track activity", cls: "mod-cta", attr: { type: "button" } }).addEventListener("click", () => this.host.openTrack(undefined, { date: this.date, status: "completed" }));

    const filter = root.createDiv({ cls: "mt-cal-filter" });
    filter.createSpan({ text: "Show:" });
    const select = filter.createEl("select", { attr: { "aria-label": "Filter calendar entries" } });
    for (const [value, label] of [["all", "All entries"], ["scheduled", "Scheduled"], ["completed", "Completed"]] as const) select.createEl("option", { text: label, attr: { value } });
    select.value = this.filter;
    select.addEventListener("change", () => { this.filter = select.value as Filter; this.render(); });

    const all = this.host.store.listAll().filter((e) => this.filter === "all" || (this.filter === "scheduled" ? isScheduled(e) : !isScheduled(e)));
    const entries = all.filter((e) => e.date === this.date || e.timestamp.slice(0, 10) === this.date);
    if (this.mode === "list") {
      this.renderList(root, all);
    } else if (this.mode === "month") {
      this.renderMonth(root, all);
    } else if (this.mode === "week") {
      const start = addDays(this.date, -((new Date(this.date + "T12:00:00").getDay() - this.host.settings.weekStartsOn + 7) % 7));
      const grid = root.createDiv({ cls: "mt-cal-week" });
      for (let i = 0; i < 7; i++) this.renderDayCell(grid, addDays(start, i), all);
    } else {
      const day = root.createDiv({ cls: "mt-cal-day" });
      day.createEl("h3", { text: this.date === this.host.today() ? "Today" : formatDateKey(this.date, this.host.settings.dateFormat) });
      if (!entries.length) day.createDiv({ cls: "mt-cal-empty", text: "No entries for this day." });
      for (const e of entries) this.renderEvent(day, e);
    }
  }

  private renderDayCell(parent: HTMLElement, date: string, events: TrackerEvent[]): void {
    const cell = parent.createDiv({ cls: "mt-cal-cell" });
    const b = cell.createEl("button", { text: String(Number(date.slice(8, 10))), attr: { type: "button", "aria-label": "Open " + date } });
    if (date === this.host.today()) b.addClass("is-today");
    b.addEventListener("click", () => { this.date = date; this.mode = "day"; this.render(); });
    const rows = events.filter((e) => e.date === date);
    cell.createDiv({ cls: "mt-cal-count", text: rows.length ? String(rows.length) + (rows.length === 1 ? " entry" : " entries") : "" });
    for (const e of rows.slice(0, 3)) cell.createDiv({ cls: "mt-cal-mini", text: (isScheduled(e) ? "◷ " : "") + e.path.join(" › ") });
  }

  private renderMonth(parent: HTMLElement, events: TrackerEvent[]): void {
    const [year, month] = this.date.split("-").map(Number);
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const offset = (new Date(first + "T12:00:00").getDay() - this.host.settings.weekStartsOn + 7) % 7;
    const start = addDays(first, -offset);
    const grid = parent.createDiv({ cls: "mt-cal-month" });
    for (const label of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) grid.createDiv({ cls: "mt-cal-weekday", text: label });
    for (let i = 0; i < 42; i++) {
      const date = addDays(start, i);
      const cell = grid.createDiv({ cls: "mt-cal-cell" });
      if (date.slice(0, 7) !== first.slice(0, 7)) cell.addClass("is-outside");
      const b = cell.createEl("button", { text: String(Number(date.slice(8, 10))), attr: { type: "button", "aria-label": "Open " + date } });
      if (date === this.host.today()) b.addClass("is-today");
      b.addEventListener("click", () => { this.date = date; this.mode = "day"; this.render(); });
      const rows = events.filter((e) => e.date === date);
      if (rows.length) cell.createDiv({ cls: "mt-cal-count", text: String(rows.length) + (rows.some(isScheduled) ? " · ◷" : "") });
    }
  }

  private renderList(parent: HTMLElement, events: TrackerEvent[]): void {
    const list = parent.createDiv({ cls: "mt-cal-list" });
    if (!events.length) list.createDiv({ cls: "mt-cal-empty", text: "No records yet." });
    for (const e of [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp))) this.renderEvent(list, e);
  }

  private renderEvent(parent: HTMLElement, event: TrackerEvent): void {
    const row = parent.createDiv({ cls: "mt-cal-event" });
    const time = row.createDiv({ cls: "mt-cal-event-time", text: event.timestamp.slice(11, 16) });
    const detail = row.createDiv({ cls: "mt-cal-event-detail" });
    detail.createDiv({ cls: "mt-cal-event-path", text: event.path.join(" › ") });
    detail.createDiv({ cls: "mt-cal-event-meta", text: `${event.durationMinutes} min · ${isScheduled(event) ? "Scheduled" : "Completed"}${event.notes ? " · " + event.notes : ""}` });
    row.createEl("button", { text: isScheduled(event) ? "Mark done / Edit" : "Edit", attr: { type: "button", "aria-label": "Edit " + event.path.join(" ") } }).addEventListener("click", () => this.host.openTrack(event));
  }
}

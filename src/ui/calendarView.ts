import { ItemView, type WorkspaceLeaf } from "obsidian";
import type { TrackerHost } from "../host";
import type { TrackerEvent } from "../core/types";
import { addDays, formatDateKey, formatShortDate, isDateKey } from "../core/dates";
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
    const shiftMonth = (date: string, delta: number): string => {
      const [year, month, day] = date.split("-").map(Number);
      const target = new Date(year, month - 1 + delta, 1, 12);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(day, lastDay));
      return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}-${String(target.getDate()).padStart(2, "0")}`;
    };
    const step = (label: string, delta: number) => {
      const b = nav.createEl("button", { text: label, attr: { type: "button" } });
      b.addEventListener("click", () => {
        this.date = this.mode === "month" ? shiftMonth(this.date, delta) : addDays(this.date, delta * (this.mode === "week" ? 7 : 1));
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
    actions.createEl("button", { text: "Track activity", cls: "mod-cta", attr: { type: "button" } }).addEventListener("click", () => this.host.openTrack(undefined, { date: this.date, status: this.date > this.host.today() ? "scheduled" : "completed" }));

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
      this.renderTimeGrid(root, Array.from({ length: 7 }, (_, i) => addDays(start, i)), all);
    } else {
      this.renderTimeGrid(root, [this.date], all);
    }
  }

  private renderTimeGrid(parent: HTMLElement, dates: string[], events: TrackerEvent[]): void {
    const grid = parent.createDiv({ cls: "mt-cal-time-grid" + (dates.length === 1 ? " is-day" : "") });
    const gutter = grid.createDiv({ cls: "mt-cal-time-gutter" });
    gutter.createDiv({ cls: "mt-cal-time-heading", text: "Time" });
    for (let hour = 0; hour < 24; hour++) gutter.createDiv({ cls: "mt-cal-hour-label", text: `${String(hour).padStart(2, "0")}:00` });
    for (const date of dates) {
      const col = grid.createDiv({ cls: "mt-cal-time-column" });
      const heading = col.createDiv({ cls: "mt-cal-time-heading" });
      const dayButton = heading.createEl("button", { text: formatShortDate(date, this.host.settings.dateFormat), attr: { type: "button", "aria-label": "Open day " + date } });
      if (date === this.host.today()) dayButton.addClass("is-today");
      dayButton.addEventListener("click", () => { this.date = date; this.mode = "day"; this.render(); });
      // Keep the 24 hourly slots as the click surface; render events as positioned
      // overlays so their height reflects duration rather than always one hour.
      for (let hour = 0; hour < 24; hour++) {
        const slot = col.createDiv({ cls: "mt-cal-hour-slot" });
        slot.addEventListener("click", (event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          const rect = slot.getBoundingClientRect();
          const minute = Math.max(0, Math.min(59, Math.floor(((event as MouseEvent).clientY - rect.top) / Math.max(1, rect.height) * 60)));
          const start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
          this.host.openTrack(undefined, { date, start, durationMinutes: 60, status: date > this.host.today() ? "scheduled" : "completed" });
        });
      }

      const dayStart = (key: string): number => {
        const [year, month, day] = key.split("-").map(Number);
        return Date.UTC(year, month - 1, day) / 86400000;
      };
      const segments = events.flatMap((e) => {
        const startMinute = Number(e.timestamp.slice(11, 13)) * 60 + Number(e.timestamp.slice(14, 16));
        const dayOffset = dayStart(date) - dayStart(e.date);
        const absoluteStart = startMinute;
        const absoluteEnd = startMinute + Math.max(1, e.durationMinutes);
        const segmentStart = dayOffset === 0 ? absoluteStart : 0;
        const segmentEnd = Math.min(absoluteEnd - dayOffset * 1440, 1440);
        if (dayOffset < 0 || absoluteStart + e.durationMinutes <= dayOffset * 1440 || segmentEnd <= segmentStart) return [];
        return [{ event: e, start: segmentStart, end: segmentEnd }];
      }).sort((a, b) => a.start - b.start || b.end - a.end);

      // Greedy interval lanes prevent simultaneous events from completely covering one another.
      const laneEnds: number[] = [];
      const positioned = segments.map((segment) => {
        let lane = laneEnds.findIndex((end) => end <= segment.start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = segment.end;
        return { ...segment, lane };
      });
      const laneCount = Math.max(1, laneEnds.length);
      for (const segment of positioned) {
        const button = col.createEl("button", {
          cls: "mt-cal-time-event" + (isScheduled(segment.event) ? " is-scheduled" : ""),
          attr: { type: "button", "aria-label": `Edit ${segment.event.path.join(" ")} at ${segment.event.timestamp.slice(11, 16)}, ${segment.event.durationMinutes} minutes` },
        });
        const top = segment.start / 60 * 48;
        const height = Math.max(18, (segment.end - segment.start) / 60 * 48 - 4);
        button.style.top = `calc(38px + ${top + 2}px)`;
        button.style.height = `${height}px`;
        button.style.left = `calc(${segment.lane / laneCount * 100}% + 2px)`;
        button.style.width = `calc(${100 / laneCount}% - 4px)`;
        button.createSpan({ cls: "mt-cal-time-event-time", text: segment.event.timestamp.slice(11, 16) });
        button.createSpan({ cls: "mt-cal-time-event-title", text: segment.event.path.join(" › ") });
        if (dayStart(date) > dayStart(segment.event.date)) button.createSpan({ cls: "mt-cal-time-event-continuation", text: "Continued from previous day" });
        if (segment.end === 1440 && segment.event.durationMinutes > segment.end - (segment.start === 0 ? 0 : segment.start)) button.createSpan({ cls: "mt-cal-time-event-continuation", text: "Continues next day" });
        button.addEventListener("click", (event) => { event.stopPropagation(); this.host.openTrack(segment.event); });
      }
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
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "mt-cal-weekday", text: weekdays[(this.host.settings.weekStartsOn + i) % 7] });
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

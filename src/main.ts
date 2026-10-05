import { Notice, Plugin, normalizePath, requestUrl, TFile } from "obsidian";
import type { TrackerHost, TrackerPaths } from "./host";
import type { TrackerEvent, TrackerSettings } from "./core/types";
import { EventStore, type ImportReport } from "./core/store";
import { createDefaultSettings, loadSettings } from "./core/defaults";
import { addDays, formatLocalIso, resolveRange, toDateKey, type ResolveOpts } from "./core/dates";
import { ensurePath } from "./core/hierarchy";
import { createBackup, backupDue, pruneBackups, stamp } from "./core/backup";
import { buildBundle, eventsToCsv } from "./core/importExport";
import { buildReport } from "./core/report";
import { formatDuration } from "./core/duration";
import { aggregateAw, fetchWindowEvents, testConnection, type HttpFn } from "./integrations/activitywatch";
import { ObsidianIO, createStructure, ensureFolder, pathsFor } from "./obsidianIO";
import { DashboardView, VIEW_TYPE } from "./ui/dashboard";
import { TrackModal } from "./ui/trackModal";
import { DrillModal } from "./ui/drilldown";
import { SetupWizard } from "./ui/setupWizard";
import { TrackerSettingTab } from "./ui/settingsTab";
import { ImportModal, QueryModal, RangePicker } from "./ui/modals";
import { renderCodeBlock } from "./ui/codeblock";

export default class MyTrackerPlugin extends Plugin implements TrackerHost {
  settings!: TrackerSettings;
  store!: EventStore;
  private io!: ObsidianIO;
  private refreshTimer: number | null = null;
  private reloadTimer: number | null = null;
  private unbind: (() => void) | null = null;

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData(), this.today());
    this.io = new ObsidianIO(this.app.vault.adapter);
    this.bindStore();

    this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.addRibbonIcon("bar-chart-3", "My Tracker: Open dashboard", () => void this.openDashboard());
    this.addSettingTab(new TrackerSettingTab(this));
    this.registerMarkdownCodeBlockProcessor("my-tracker", (src, el, ctx) => renderCodeBlock(this, src, el, ctx));

    const cmd = (id: string, name: string, fn: () => void | Promise<void>, needsSetup = true) =>
      this.addCommand({ id, name, callback: () => { if (needsSetup && !this.ensureReady()) return; void fn(); } });
    cmd("track-activity", "Track Activity", () => this.openTrack());
    cmd("open-dashboard", "Open dashboard", () => this.openDashboard());
    cmd("quick-query", "Ask a question (e.g. “Math this month”)", () => new QueryModal(this).open());
    cmd("undo-last", "Undo last change", () => this.undoLast());
    cmd("generate-report", "Generate report", () => new RangePicker(this, (id) => void this.generateReport(id)).open());
    cmd("sync-activitywatch", "Sync ActivityWatch", () => this.syncActivityWatch(true));
    cmd("backup-now", "Back up now", () => this.backupNow());
    cmd("export-json", "Export all data (JSON)", () => this.exportData("json"));
    cmd("export-csv", "Export all data (CSV)", () => this.exportData("csv"));
    cmd("import", "Import data…", () => this.openImport());
    cmd("reload-data", "Reload data from disk", async () => { const r = await this.store.load(); new Notice(`Loaded ${r.events} events${r.quarantined.length ? `, ${r.quarantined.length} unreadable line(s) quarantined` : ""}.`); });
    cmd("setup", "Run setup wizard", () => new SetupWizard(this).open(), false);

    this.registerEvent(this.app.vault.on("modify", (f) => {
      if (!this.settings.setupComplete || !f.path.startsWith(this.paths().database + "/") || Date.now() - this.store.lastWriteAt < 2500) return;
      if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => void this.store.load(), 1000); // changed by sync/another device
    }));

    this.app.workspace.onLayoutReady(async () => {
      if (!this.settings.setupComplete) new SetupWizard(this).open();
      else await this.loadStore();
    });
  }

  onunload(): void { this.unbind?.(); if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer); if (this.reloadTimer !== null) window.clearTimeout(this.reloadTimer); }

  // ---------- host API ----------
  now(): Date { return new Date(); }
  today(): string { return toDateKey(new Date()); }
  paths(): TrackerPaths { return pathsFor(this.settings.rootFolder); }
  resolveOpts(): ResolveOpts {
    const first = this.store?.list()[0]?.date;
    return { weekStartsOn: this.settings.weekStartsOn, installDate: first && first < this.settings.installDate ? first : this.settings.installDate };
  }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.refreshViews(); }
  openTrack(event?: TrackerEvent): void { if (this.ensureReady()) new TrackModal(this, event).open(); }
  openDrill(title: string, query: () => TrackerEvent[]): void { new DrillModal(this, title, query).open(); }
  openImport(): void { new ImportModal(this, (rep, name) => this.afterImport(rep, name)).open(); }

  refreshViews(): void {
    if (this.refreshTimer !== null) return;
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) { const view = leaf.view; if (view instanceof DashboardView) view.refresh(); }
    }, 120);
  }

  // ---------- setup & storage ----------
  private ensureReady(): boolean {
    if (this.settings.setupComplete) return true;
    new SetupWizard(this).open();
    return false;
  }
  private bindStore(): void {
    this.unbind?.();
    this.store = new EventStore(this.io, this.paths().database);
    this.unbind = this.store.onChange(() => this.refreshViews());
  }
  async completeSetup(folder: string, starter: boolean, mode: "simple" | "advanced" = "simple"): Promise<void> {
    const today = this.today();
    this.settings.rootFolder = folder;
    this.settings.dashboard.mode = mode;
    if (!starter) this.settings.tree = [];
    else if (!this.settings.tree.length) this.settings.tree = createDefaultSettings(today).tree;
    this.settings.installDate = today;
    await createStructure(this.app.vault, folder);
    this.settings.setupComplete = true;
    await this.saveData(this.settings);
    this.bindStore();
    await this.loadStore();
    await this.openDashboard();
  }
  private async loadStore(): Promise<void> {
    await ensureFolder(this.app.vault.adapter, this.paths().database);
    const rep = await this.store.load();
    if (rep.newlyQuarantined) new Notice(`My Tracker: ${rep.newlyQuarantined} unreadable line(s) were set aside in ${this.paths().database}/quarantine.jsonl. Nothing was deleted.`, 10000);
    if (this.settings.backup.auto && this.store.size && backupDue(this.settings.backup.lastBackupAt, this.settings.backup.intervalDays, this.now())) {
      try { await this.backupNow(true); } catch (e) { console.error("My Tracker: automatic backup failed", e); }
    }
    if (this.settings.activityWatch.enabled) void this.syncActivityWatch(false);
  }

  async openDashboard(): Promise<void> {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) { void ws.revealLeaf(existing); return; }
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    void ws.revealLeaf(leaf);
  }

  async undoLast(): Promise<void> {
    const label = this.store.undoLabel;
    const r = await this.store.undo();
    new Notice(r.ok ? `Undone: ${label}` : "Nothing to undo in this session.");
  }

  // ---------- backup / export / import ----------
  async backupNow(silent = false): Promise<void> {
    const path = await createBackup(this.io, this.paths().backups, this.store, this.settings, this.now());
    this.settings.backup.lastBackupAt = formatLocalIso(this.now());
    await this.saveData(this.settings);
    await pruneBackups(this.io, this.paths().backups, this.settings.backup.keep);
    if (!silent) new Notice(`Backup saved: ${path}`);
  }
  async exportData(kind: "json" | "csv"): Promise<void> {
    const dir = this.paths().backups;
    await ensureFolder(this.app.vault.adapter, dir);
    let path = `${dir}/export-${stamp(this.now())}.${kind}`;
    for (let i = 1; await this.io.exists(path); i++) path = `${dir}/export-${stamp(this.now())}-${i}.${kind}`;
    await this.io.write(path, kind === "json" ? JSON.stringify(buildBundle(this.store.list(), this.settings, this.now()), null, 1) : eventsToCsv(this.store.list()));
    new Notice(`Exported ${this.store.size} events to ${path}`);
  }
  private async syncTreeWithEvents(): Promise<void> {
    let created = 0;
    for (const e of this.store.list()) created += ensurePath(this.settings.tree, e.path).length;
    if (created) await this.saveSettings();
  }
  private async afterImport(rep: ImportReport, source: string): Promise<void> {
    if (rep.invalid.length) {
      const dir = this.paths().backups;
      await ensureFolder(this.app.vault.adapter, dir);
      const path = `${dir}/import-rejects-${stamp(this.now())}.json`;
      await this.io.write(path, JSON.stringify({ source, rejected: rep.invalid }, null, 1));
      new Notice(`${rep.invalid.length} row(s) could not be imported and were saved to ${path}`, 10000);
    }
    await this.syncTreeWithEvents();
    new Notice(`Import finished: ${rep.added} added, ${rep.duplicates} duplicates skipped${rep.conflicts ? `, ${rep.conflicts} id conflicts skipped` : ""}.`);
  }

  // ---------- reports ----------
  private async generateReport(id: Parameters<typeof resolveRange>[0]["id"]): Promise<void> {
    const range = resolveRange({ id }, this.today(), this.resolveOpts());
    const md = buildReport(range, this.store.list(), this.settings.tree, this.today(), this.settings.dashboard.metrics);
    const dir = this.paths().reports;
    await ensureFolder(this.app.vault.adapter, dir);
    const base = `${dir}/${range.label.replace(/[\\/:*?"<>|]/g, "-")} ${range.start}`;
    let path = normalizePath(`${base}.md`);
    for (let i = 2; this.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${base} (${i}).md`);
    const file = await this.app.vault.create(path, md);
    if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
  }

  // ---------- ActivityWatch ----------
  private http: HttpFn = async (req) => {
    const r = await requestUrl({ url: req.url, method: req.method, body: req.body, contentType: "application/json", throw: false });
    let json: unknown = null;
    try { json = r.json; } catch { /* non-JSON body */ }
    return { status: r.status, json };
  };
  async testActivityWatch(): Promise<void> {
    try { new Notice(await testConnection(this.http, this.settings.activityWatch.url)); }
    catch (e) { new Notice(`Could not reach ActivityWatch at ${this.settings.activityWatch.url}. Is it running? (${String(e)})`, 8000); }
  }
  async syncActivityWatch(notify = true): Promise<void> {
    const aw = this.settings.activityWatch;
    if (!aw.enabled) { if (notify) new Notice("ActivityWatch is disabled. Enable it in My Tracker settings first."); return; }
    try {
      const today = this.today(), start = addDays(today, -(aw.syncDays - 1));
      const events = await fetchWindowEvents(this.http, aw.url, start, today);
      const daily = aggregateAw(events, aw.rules);
      const inputs = daily.map((d) => {
        const [y, m, dd] = d.date.split("-").map(Number);
        return { timestamp: formatLocalIso(new Date(y, m - 1, dd, 12, 0)), path: d.path, durationMinutes: d.minutes, tags: [] as string[], notes: "", source: "activitywatch", externalId: d.externalId };
      });
      const r = await this.store.upsertExternal(inputs);
      if (!r.ok) throw new Error(r.errors.join("; "));
      await this.syncTreeWithEvents();
      if (notify) new Notice(`ActivityWatch: ${r.value.added} added, ${r.value.updated} updated, ${r.value.unchanged} unchanged (${formatDuration(daily.reduce((a, d) => a + d.minutes, 0))} total).`);
    } catch (e) {
      if (notify) new Notice(`ActivityWatch sync failed: ${String(e)}`, 8000);
      else console.warn("My Tracker: ActivityWatch sync skipped", e);
    }
  }
}

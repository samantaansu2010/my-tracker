import { Notice, PluginSettingTab, Setting } from "obsidian";
import type MyTrackerPlugin from "../main";
import type { SubjectNode, Target } from "../core/types";
import { flatten, makeNode, pathKey, pathLabel, removeNode, renameNode, ensurePath, findNode } from "../core/hierarchy";
import { formatDuration, parseDuration } from "../core/duration";
import { METRICS } from "../core/metrics";
import { describeIndexFormula } from "../core/performance";
import { newId } from "../core/ids";
import { renderLayoutEditor } from "./layoutEditor";
import { PALETTE } from "../core/colors";
import { applyRenameToSettings } from "../core/defaults";
import { RANGE_LABELS, isDateKey } from "../core/dates";
import { parseAwRules, parseIntervals, parseList, parseMeasurements, parseResultScale, parseWeights, serializeAwRules, serializeMeasurements, serializeResultScale, serializeWeights } from "../core/settingsText";
import type { RangeId } from "../core/types";

export class TrackerSettingTab extends PluginSettingTab {
  constructor(private plugin: MyTrackerPlugin) { super(plugin.app, plugin); }

  private get s() { return this.plugin.settings; }
  private async save(): Promise<void> { await this.plugin.saveSettings(); }
  private heading(t: string, desc?: string): void { const h = new Setting(this.containerEl).setName(t).setHeading(); if (desc) h.setDesc(desc); }
  /** Text area that validates on blur and shows the error inline instead of silently discarding input. */
  private area(name: string, desc: string, value: string, apply: (text: string) => string | null, rows = 3): void {
    const st = new Setting(this.containerEl).setName(name).setDesc(desc);
    st.settingEl.addClass("mt-setting-area");
    const err = st.descEl.createDiv({ cls: "mt-error" });
    st.addTextArea((t) => { t.setValue(value); t.inputEl.rows = rows; t.inputEl.addEventListener("blur", async () => { const e = apply(t.getValue()); err.setText(e ?? ""); if (!e) await this.save(); }); });
  }

  display(): void {
    const c = this.containerEl; c.empty();
    const s = this.s;

    this.heading("General");
    new Setting(c).setName("Tracking folder").setDesc(`Data lives in “${s.rootFolder}”. To move it, move the folder in your file explorer, then change this name and restart Obsidian.`).addText((t) => { t.setValue(s.rootFolder); t.inputEl.addEventListener("blur", async () => { const v = t.getValue().trim(); if (v && v !== s.rootFolder && !/[\\:*?"<>|]/.test(v)) { s.rootFolder = v; await this.save(); new Notice("Folder changed. Reload Obsidian to read data from the new location."); } }); });
    new Setting(c).setName("Default category").setDesc("Used when you enter a brand-new subject without a category.").addDropdown((d) => { for (const n of s.tree) d.addOption(n.name, n.name); d.setValue(s.defaultCategory); d.onChange(async (v) => { s.defaultCategory = v; await this.save(); }); });
    new Setting(c).setName("Date format").addDropdown((d) => d.addOptions({ "YYYY-MM-DD": "2026-09-29", "DD/MM/YYYY": "29/09/2026", "MM/DD/YYYY": "09/29/2026", "D MMM YYYY": "29 Sep 2026" }).setValue(s.dateFormat).onChange(async (v) => { s.dateFormat = v as typeof s.dateFormat; await this.save(); }));
    new Setting(c).setName("Time format").addDropdown((d) => d.addOptions({ "24h": "24-hour", "12h": "12-hour" }).setValue(s.timeFormat).onChange(async (v) => { s.timeFormat = v as "24h" | "12h"; await this.save(); }));
    new Setting(c).setName("Week starts on").addDropdown((d) => d.addOptions({ "1": "Monday", "0": "Sunday", "6": "Saturday" }).setValue(String(s.weekStartsOn)).onChange(async (v) => { s.weekStartsOn = Number(v); await this.save(); }));
    new Setting(c).setName("Default duration unit").setDesc("How a bare number such as “Math 45” or “2” is read.").addDropdown((d) => d.addOptions({ minutes: "Minutes", hours: "Hours" }).setValue(s.defaultDurationUnit).onChange(async (v) => { s.defaultDurationUnit = v as "minutes" | "hours"; await this.save(); }));

    this.heading("Subjects, aliases and hierarchy", "Names are canonical; aliases (e.g. Math → Mathematics, JS → JavaScript) resolve to them. Renaming rewrites past events. Deleting a subject here keeps its events.");
    const box = c.createDiv({ cls: "mt-tree-editor" });
    this.renderTree(box);
    new Setting(c).addButton((b) => b.setButtonText("Add category").onClick(async () => { s.tree.push(makeNode("New category")); await this.save(); this.display(); }));

    this.heading("Results and measurements");
    this.area("Result scale", "Label=value pairs, best last or first — the numeric value is only used to scale grades to 0–1. Example: A=4, B=3, C=2, D=1", serializeResultScale(s.resultScale), (t) => { const r = parseResultScale(t); if (r.error) return r.error; s.resultScale = r.value; return null; }, 2);
    this.area("Measurements", "One per line: key|Name|min|max|unit. Enter them as recall:8/10 or accuracy:85% in quick entry.", serializeMeasurements(s.measurements), (t) => { const r = parseMeasurements(t); if (r.error) return r.error; s.measurements = r.value; return null; }, 4);
    this.area("Session types", "Comma-separated. Example: Study, Recall, Revision, Practice, Test, Reading, Research, Writing", s.kinds.join(", "), (t) => { s.kinds = parseList(t); return null; }, 2);
    this.area("Types that count as recall", "Comma-separated subset of the types above.", s.recallKinds.join(", "), (t) => { s.recallKinds = parseList(t); return null; }, 2);
    new Setting(c).setName("Include result grade in performance index").addToggle((tg) => tg.setValue(s.performance.includeResult).onChange(async (v) => { s.performance.includeResult = v; await this.save(); this.display(); }));
    new Setting(c).setName("Result grade weight").addText((t) => { t.setValue(String(s.performance.resultWeight)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isFinite(v) && v >= 0) { s.performance.resultWeight = v; await this.save(); this.display(); } }); });
    this.area("Measurement weights", "Which measurements feed the performance index, e.g. recall=1, accuracy=0.5. Leave empty to ignore them.", serializeWeights(s.performance.measurementWeights), (t) => { const r = parseWeights(t); if (r.error) return r.error; s.performance.measurementWeights = r.value; return null; }, 2);
    c.createDiv({ cls: "setting-item-description mt-formula", text: describeIndexFormula(s.performance, s.measurements) });

    this.heading("Targets", "Progress, remaining time and history are calculated for you.");
    this.renderTargets(c);

    this.heading("Neglected areas");
    new Setting(c).setName("Default threshold (days)").setDesc("A subject is flagged when its last activity is older than this. Set per-subject thresholds and “intentionally/temporarily inactive” in the subject list above.").addText((t) => { t.setValue(String(s.neglect.defaultThresholdDays)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isInteger(v) && v >= 1) { s.neglect.defaultThresholdDays = v; await this.save(); } }); });

    this.heading("Recall");
    new Setting(c).setName("Spaced-repetition reminders").setDesc("Shows items due for review on the dashboard. Computed from your events; nothing extra is stored.").addToggle((tg) => tg.setValue(s.recall.srsEnabled).onChange(async (v) => { s.recall.srsEnabled = v; await this.save(); }));
    this.area("Review intervals (days)", "Gap after first study, then after each recall day. Example: 1, 3, 7, 14, 30, 60", s.recall.intervals.join(", "), (t) => { const r = parseIntervals(t); if (r.error || !r.value.length) return r.error ?? "Add at least one interval"; s.recall.intervals = r.value; return null; }, 1);

    this.heading("Dashboard", "Choose how much you see. Hidden sections are never deleted — switch them back on here any time.");
    new Setting(c).setName("View mode").setDesc("Simple: today, this week, goals and where your time goes. Advanced: every metric, chart and comparison.").addDropdown((d) => d.addOptions({ simple: "Simple", advanced: "Advanced" }).setValue(s.dashboard.mode).onChange(async (v) => { s.dashboard.mode = v as "simple" | "advanced"; await this.save(); }));
    new Setting(c).setName("Default range (Advanced view)").addDropdown((d) => { for (const id of ["today", "last7", "last14", "last30", "last90", "thisWeek", "thisMonth", "thisYear", "sinceInstall"]) d.addOption(id, RANGE_LABELS[id]); d.setValue(s.dashboard.defaultRange).onChange(async (v) => { s.dashboard.defaultRange = v as RangeId; await this.save(); }); });
    for (const mode of ["simple", "advanced"] as const) {
      const det = c.createEl("details", { cls: "mt-details mt-settings-details" });
      det.createEl("summary", { text: mode === "simple" ? "Sections shown in the Simple view" : "Sections shown in the Advanced view" });
      renderLayoutEditor(det.createDiv(), this.plugin, mode);
    }
    c.createEl("div", { cls: "setting-item-description", text: "Numbers shown in “Key numbers” (hover for the exact definition):" });
    const mbox = c.createDiv({ cls: "mt-metric-pick" });
    for (const m of METRICS) {
      const l = mbox.createEl("label", { cls: "mt-check", attr: { title: m.definition } });
      const cb = l.createEl("input", { attr: { type: "checkbox" } }); cb.checked = s.dashboard.metrics.includes(m.id);
      l.createSpan({ text: m.label });
      cb.addEventListener("change", async () => { s.dashboard.metrics = METRICS.map((x) => x.id).filter((id) => (id === m.id ? cb.checked : s.dashboard.metrics.includes(id))); await this.save(); });
    }
    new Setting(c).setName("Moving-average window (days)").addText((t) => { t.setValue(String(s.charts.movingAverageWindow)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isInteger(v) && v >= 2 && v <= 60) { s.charts.movingAverageWindow = v; await this.save(); } }); });

    this.heading("ActivityWatch (optional)", "Imports per-app computer time from ActivityWatch running on this computer. Totals appear under Technology › Computer. Everything works without it.");
    new Setting(c).setName("Enable").addToggle((tg) => tg.setValue(s.activityWatch.enabled).onChange(async (v) => { s.activityWatch.enabled = v; await this.save(); }));
    new Setting(c).setName("Server address").addText((t) => { t.setValue(s.activityWatch.url); t.inputEl.addEventListener("blur", async () => { s.activityWatch.url = t.getValue().trim() || "http://localhost:5600"; await this.save(); }); });
    new Setting(c).setName("Days to sync").setDesc("Each sync refreshes this many recent days (safe to repeat; records are updated, never duplicated).").addText((t) => { t.setValue(String(s.activityWatch.syncDays)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isInteger(v) && v >= 1 && v <= 365) { s.activityWatch.syncDays = v; await this.save(); } }); });
    this.area("Mapping rules", "Optional, one per line: app | discord | Technology > Discord  (title also works; wrap in /slashes/ for regex). Unmapped apps go to Technology › Computer › <app>.", serializeAwRules(s.activityWatch.rules), (t) => { const r = parseAwRules(t); if (r.error) return r.error; s.activityWatch.rules = r.value; return null; }, 3);
    new Setting(c).addButton((b) => b.setButtonText("Test connection").onClick(() => void this.plugin.testActivityWatch())).addButton((b) => b.setButtonText("Sync now").onClick(() => void this.plugin.syncActivityWatch(true)));

    this.heading("Backup, export and import");
    new Setting(c).setName("Automatic backups").addToggle((tg) => tg.setValue(s.backup.auto).onChange(async (v) => { s.backup.auto = v; await this.save(); }));
    new Setting(c).setName("Back up every (days)").addText((t) => { t.setValue(String(s.backup.intervalDays)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isInteger(v) && v >= 1) { s.backup.intervalDays = v; await this.save(); } }); });
    new Setting(c).setName("Backups to keep").addText((t) => { t.setValue(String(s.backup.keep)); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); if (Number.isInteger(v) && v >= 1) { s.backup.keep = v; await this.save(); } }); });
    new Setting(c).setName("Data").setDesc(`${this.plugin.store?.size ?? 0} events. Backups, exports and rejected import rows are written to ${this.plugin.paths().backups}.`)
      .addButton((b) => b.setButtonText("Back up now").onClick(() => void this.plugin.backupNow()))
      .addButton((b) => b.setButtonText("Export JSON").onClick(() => void this.plugin.exportData("json")))
      .addButton((b) => b.setButtonText("Export CSV").onClick(() => void this.plugin.exportData("csv")))
      .addButton((b) => b.setButtonText("Import…").onClick(() => this.plugin.openImport()));
    new Setting(c).setName("Installation date").setDesc("“Since installation” starts here (or at your earliest event, if that is older).").addText((t) => { t.setValue(s.installDate); t.inputEl.addEventListener("blur", async () => { if (isDateKey(t.getValue())) { s.installDate = t.getValue(); await this.save(); } }); });
  }

  // ---------- subject tree editor ----------
  private renderTree(parent: HTMLElement): void {
    const s = this.s;
    const walk = (nodes: SubjectNode[], prefix: string[]) => {
      for (const node of [...nodes]) {
        const path = [...prefix, node.name];
        const row = new Setting(parent).setName("");
        row.settingEl.addClass("mt-tree-row"); row.settingEl.style.marginLeft = `${prefix.length * 18}px`;
        row.nameEl.setText(prefix.length ? "↳" : "▸");
        row.addText((t) => { t.setPlaceholder("Name").setValue(node.name); t.inputEl.setAttribute("aria-label", `Name of ${pathLabel(path)}`);
          t.inputEl.addEventListener("blur", async () => {
            const nn = t.getValue().trim(); if (nn === node.name) return;
            const res = renameNode(s.tree, path, nn); if (!res.ok) { new Notice(res.error); t.setValue(node.name); return; }
            const r = await this.plugin.store.renamePath(path, [...prefix, nn]);
            if (!r.ok) { node.name = path[path.length - 1]; new Notice(`Rename failed: ${r.errors.join("; ")}`); return; }
            applyRenameToSettings(s, path, [...prefix, nn]);
            if (r.value) new Notice(`Renamed. ${r.value} past event${r.value === 1 ? "" : "s"} updated (undoable).`);
            await this.save(); this.display();
          }); });
        row.addText((t) => { t.setPlaceholder("aliases, comma separated").setValue(node.aliases.join(", ")); t.inputEl.setAttribute("aria-label", `Aliases of ${pathLabel(path)}`); t.inputEl.addEventListener("blur", async () => { node.aliases = parseList(t.getValue()); await this.save(); }); });
        row.addDropdown((d) => { d.addOptions({ "": "Active", intentional: "Intentionally inactive", temporary: "Temporarily inactive" }).setValue(node.inactive ?? "").onChange(async (v) => { node.inactive = (v || undefined) as SubjectNode["inactive"]; if (!v) node.pausedUntil = undefined; await this.save(); this.display(); }); });
        if (node.inactive === "temporary") row.addText((t) => { t.setPlaceholder("until YYYY-MM-DD").setValue(node.pausedUntil ?? ""); t.inputEl.addEventListener("blur", async () => { const v = t.getValue().trim(); if (!v || isDateKey(v)) { node.pausedUntil = v || undefined; await this.save(); } else new Notice("Use the format YYYY-MM-DD"); }); });
        row.addDropdown((d) => { d.addOption("", "Auto colour"); for (const col of PALETTE) d.addOption(col, col[0].toUpperCase() + col.slice(1)); d.setValue(node.color ?? "").onChange(async (v) => { node.color = v || undefined; await this.save(); }); });
        row.addText((t) => { t.setPlaceholder("neglect days").setValue(node.neglectDays ? String(node.neglectDays) : ""); t.inputEl.size = 8; t.inputEl.setAttribute("aria-label", `Neglect threshold in days for ${pathLabel(path)}`); t.inputEl.addEventListener("blur", async () => { const v = Number(t.getValue()); node.neglectDays = Number.isInteger(v) && v >= 1 ? v : undefined; await this.save(); }); });
        row.addExtraButton((b) => b.setIcon("plus").setTooltip("Add child").onClick(async () => { ensurePath(s.tree, [...path, "New subject"]); await this.save(); this.display(); }));
        row.addExtraButton((b) => b.setIcon("trash").setTooltip("Remove from list (events are kept)").onClick(async () => { removeNode(s.tree, path); if (!s.tree.some((n) => n.name === s.defaultCategory) && s.tree[0]) s.defaultCategory = s.tree[0].name; await this.save(); this.display(); }));
        walk(node.children, path);
      }
    };
    walk(s.tree, []);
    if (!s.tree.length) parent.createDiv({ cls: "mt-muted", text: "No subjects yet. Add a category, or just start tracking — new subjects are created as you type them." });
  }

  // ---------- targets ----------
  private renderTargets(c: HTMLElement): void {
    const s = this.s;
    const paths = flatten(s.tree).map((f) => f.path);
    for (const t of s.targets) {
      const row = new Setting(c);
      row.addDropdown((d) => { for (const p of paths) d.addOption(pathKey(p), pathLabel(p)); if (!paths.some((p) => pathKey(p) === pathKey(t.path))) d.addOption(pathKey(t.path), pathLabel(t.path)); d.setValue(pathKey(t.path)).onChange(async (v) => { t.path = v.split("\u001f"); await this.save(); }); });
      row.addText((x) => { x.setPlaceholder("10h").setValue(formatDuration(t.minutes)); x.inputEl.size = 8; x.inputEl.addEventListener("blur", async () => { const m = parseDuration(x.getValue(), s.defaultDurationUnit); if (m) { t.minutes = m; await this.save(); } else { new Notice("Duration not understood"); x.setValue(formatDuration(t.minutes)); } }); });
      row.addDropdown((d) => d.addOptions({ day: "per day", week: "per week", month: "per month" }).setValue(t.period).onChange(async (v) => { t.period = v as Target["period"]; await this.save(); }));
      row.addExtraButton((b) => b.setIcon("trash").setTooltip("Delete target").onClick(async () => { s.targets = s.targets.filter((x) => x !== t); await this.save(); this.display(); }));
    }
    new Setting(c).addButton((b) => b.setButtonText("Add target").onClick(async () => { const first = paths[0]; if (!first) { new Notice("Add a subject first."); return; } s.targets.push({ id: newId("tgt"), path: findNode(s.tree, first) ? first : [first[0]], minutes: 600, period: "week" }); await this.save(); this.display(); }));
  }
}

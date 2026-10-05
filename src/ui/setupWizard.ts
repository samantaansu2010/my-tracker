import { Modal, Notice, Setting } from "obsidian";
import type MyTrackerPlugin from "../main";

/** First-run wizard. Creates only new folders/notes under the chosen root; never touches other vault files. */
export class SetupWizard extends Modal {
  private folder: string;
  private starter = true;
  private mode: "simple" | "advanced" = "simple";
  constructor(private plugin: MyTrackerPlugin) { super(plugin.app); this.folder = plugin.settings.rootFolder || "Tracking"; }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Set up My Tracker" });
    contentEl.createEl("p", { text: "My Tracker keeps everything in your vault as plain files. Nothing leaves your device." });
    new Setting(contentEl).setName("Tracking folder").setDesc("Created if it doesn't exist. You can use a path like Life/Tracking.").addText((t) => t.setValue(this.folder).onChange((v) => (this.folder = v.trim())));
    new Setting(contentEl).setName("Start with example subjects").setDesc("Mathematics, English, Physical Science, Programming… You can edit or remove them in settings.").addToggle((t) => t.setValue(this.starter).onChange((v) => (this.starter = v)));
    new Setting(contentEl).setName("Choose your view").setDesc("Simple is calm and friendly. Advanced shows every chart and statistic. You can switch any time.").addDropdown((d) => d.addOptions({ simple: "Simple (recommended)", advanced: "Advanced" }).setValue(this.mode).onChange((v) => (this.mode = v as "simple" | "advanced")));
    contentEl.createEl("pre", { cls: "mt-tree", text: "Tracking/\n├── Database/   your events (append-only log)\n├── Subjects/\n├── Templates/\n├── Dashboard/\n├── Reports/\n└── Backups/" });
    const err = contentEl.createDiv({ cls: "mt-error" });
    new Setting(contentEl).addButton((b) => b.setButtonText("Create").setCta().onClick(async () => {
      if (!this.folder || /[\\:*?"<>|]/.test(this.folder) || this.folder.split("/").some((s) => s === "..")) { err.setText("Please enter a valid folder path."); return; }
      b.setDisabled(true);
      try { await this.plugin.completeSetup(this.folder, this.starter, this.mode); new Notice("My Tracker is ready. Try “My Tracker: Track activity”."); this.close(); }
      catch (e) { err.setText(`Setup failed: ${String(e)}`); b.setDisabled(false); }
    })).addButton((b) => b.setButtonText("Later").onClick(() => this.close()));
  }
  onClose(): void { this.contentEl.empty(); }
}

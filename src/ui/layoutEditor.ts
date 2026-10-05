import { Modal, Setting } from "obsidian";
import type { TrackerHost } from "../host";
import { WIDGETS, defaultVisibility, isVisible, type ViewMode, type WidgetGroup } from "../core/widgets";

/** Toggle list for every dashboard widget in one view mode. Used by the Customize window and by Settings. */
export function renderLayoutEditor(parent: HTMLElement, host: TrackerHost, mode: ViewMode): void {
  const d = host.settings.dashboard;
  const groups: WidgetGroup[] = ["Overview", "Charts", "Analysis"];
  for (const g of groups) {
    new Setting(parent).setName(g).setHeading();
    for (const w of WIDGETS.filter((x) => x.group === g)) {
      new Setting(parent).setName(w.label).setDesc(w.description)
        .addToggle((t) => t.setValue(isVisible(d.visibility, mode, w.id)).onChange(async (v) => { d.visibility[mode][w.id] = v; await host.saveSettings(); }));
    }
  }
  new Setting(parent).setName("Reset this view").setDesc(`Go back to the default sections for the ${mode} view.`)
    .addButton((b) => b.setButtonText("Reset to defaults").onClick(async () => {
      d.visibility[mode] = defaultVisibility()[mode];
      await host.saveSettings();
      parent.empty(); renderLayoutEditor(parent, host, mode);
    }));
}

/** "Customize dashboard": choose what each view shows. Nothing is deleted — switch sections back on any time. */
export class LayoutModal extends Modal {
  constructor(private host: TrackerHost, private mode: ViewMode) { super(host.app); }
  onOpen(): void {
    this.modalEl.addClass("mt-layout");
    this.draw();
  }
  private draw(): void {
    const { contentEl } = this; contentEl.empty();
    contentEl.createEl("h2", { text: "Customize dashboard" });
    const seg = contentEl.createDiv({ cls: "mt-seg", attr: { role: "group", "aria-label": "Which view to edit" } });
    for (const m of ["simple", "advanced"] as ViewMode[]) {
      const b = seg.createEl("button", { cls: "mt-seg-btn" + (m === this.mode ? " is-active" : ""), text: m === "simple" ? "Simple view" : "Advanced view", attr: { "aria-pressed": String(m === this.mode) } });
      b.addEventListener("click", () => { this.mode = m; this.draw(); });
    }
    const list = contentEl.createDiv({ cls: "mt-layout-list" });
    renderLayoutEditor(list, this.host, this.mode);
  }
  onClose(): void { this.contentEl.empty(); }
}

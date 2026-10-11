import { Notice } from "obsidian";
import type { TrackerHost } from "../host";
import { recentEntries } from "../core/recent";
import { formatDuration } from "../core/duration";
import { formatLocalIso } from "../core/dates";
import { canonicalizePath, ensurePath, pathLabel } from "../core/hierarchy";

/** One-tap repeat: tapping a chip logs the same entry again, right now. Undo is offered in the confirmation. */
export function renderRecentChips(parent: HTMLElement, host: TrackerHost, onLogged: () => void): void {
  const items = recentEntries(host.store.list(), { limit: 6 });
  if (!items.length) return;
  const wrap = parent.createDiv({ cls: "mt-recent", attr: { role: "group", "aria-label": "Log again" } });
  wrap.createSpan({ cls: "mt-muted mt-recent-label", text: "Again" });
  let busy = false;
  for (const it of items) {
    const short = it.path.length > 1 ? it.path.slice(1).join(" › ") : it.path[0];
    const label = `${short} · ${formatDuration(it.durationMinutes)}${it.result ? ` · ${it.result}` : ""}`;
    const b = wrap.createEl("button", { cls: "mt-recent-chip", text: label, attr: { title: `${pathLabel(it.path)} — log again now`, "aria-label": `Log again: ${pathLabel(it.path)}, ${formatDuration(it.durationMinutes)}` } });
    b.addEventListener("click", async () => {
      if (busy) return;
      busy = true; wrap.addClass("is-busy");
      try {
        const at = host.now(); at.setSeconds(0, 0); // minute precision, like typed entries (keeps the duplicate guard meaningful)
        const path = canonicalizePath(host.settings.tree, it.path);
        const res = await host.store.add({ timestamp: formatLocalIso(at), path, durationMinutes: it.durationMinutes, kind: it.kind, result: it.result, plannedMinutes: it.plannedMinutes, tags: it.tags, notes: "", source: "manual" });
        if (!res.ok) { new Notice(res.reason === "duplicate" ? "You already logged this a moment ago." : `Could not save: ${res.errors.join("; ")}`); return; }
        if (ensurePath(host.settings.tree, path).length) await host.saveSettings();
        const frag = createFragment();
        frag.createSpan({ text: `Logged: ${path.join(" › ")} · ${formatDuration(it.durationMinutes)}  ` });
        frag.createEl("button", { text: "Undo" }).addEventListener("click", () => void host.undoLast());
        new Notice(frag, 6000);
        onLogged();
      } finally { busy = false; wrap.removeClass("is-busy"); }
    });
  }
}

import type { App } from "obsidian";
import type { EventStore } from "./core/store";
import type { ResolveOpts } from "./core/dates";
import type { TrackerEvent, TrackerSettings } from "./core/types";

export interface TrackerPaths { root: string; database: string; subjects: string; templates: string; dashboard: string; reports: string; backups: string }

/** What UI components may use from the plugin. Keeps views/modals decoupled from the Plugin class. */
export interface TrackerHost {
  app: App;
  settings: TrackerSettings;
  store: EventStore;
  paths(): TrackerPaths;
  saveSettings(): Promise<void>;
  now(): Date;
  today(): string;
  resolveOpts(): ResolveOpts;
  openTrack(event?: TrackerEvent): void;
  openDrill(title: string, query: () => TrackerEvent[]): void;
  syncActivityWatch(notify?: boolean): Promise<void>;
  testActivityWatch(): Promise<void>;
  exportData(kind: "json" | "csv"): Promise<void>;
  openImport(): void;
  backupNow(): Promise<void>;
  undoLast(): Promise<void>;
  refreshViews(): void;
}

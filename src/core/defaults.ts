import type { SubjectNode, TrackerSettings } from "./types";
import { SETTINGS_SCHEMA_VERSION } from "./types";
import { makeNode } from "./hierarchy";
import { migrateRecord, type Migration } from "./migrate";
import { defaultVisibility, legacySectionsToVisibility } from "./widgets";

/** v1 -> v2: per-section flags became per-widget visibility; existing users keep the full (advanced) experience. */
export const SETTINGS_MIGRATIONS: Migration[] = [{
  from: 1,
  migrate: (r) => {
    const d = (typeof r.dashboard === "object" && r.dashboard ? r.dashboard : {}) as Record<string, unknown>;
    const { sections, ...rest } = d;
    const advanced = legacySectionsToVisibility((typeof sections === "object" && sections ? sections : {}) as Record<string, unknown>);
    return { ...r, dashboard: { ...rest, mode: "advanced", visibility: { advanced } } };
  },
}];

/** Deliberately minimal starter tree. Users add anything else. */
export function starterTree(): SubjectNode[] {
  return [
    makeNode("Academic", [], [
      makeNode("Mathematics", ["Math", "Maths"], [makeNode("Algebra")]),
      makeNode("English"),
      makeNode("Physical Science", ["Physics", "Phys Sci", "Science"]),
    ]),
    makeNode("Technology", [], [
      makeNode("Programming", ["Coding", "Code"], [makeNode("JavaScript", ["JS"]), makeNode("Python", ["Py"])]),
      makeNode("Computer"),
    ]),
  ];
}

export const DEFAULT_METRICS = ["total", "sessions", "activeDays", "consistency", "avgPerActiveDay", "avgSession", "medianSession", "longestSession", "longestGap", "daysSinceLast", "streak", "trend"];

export function createDefaultSettings(today: string, withStarter = true): TrackerSettings {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    setupComplete: false,
    rootFolder: "Tracking",
    installDate: today,
    tree: withStarter ? starterTree() : [],
    defaultCategory: "Academic",
    dateFormat: "YYYY-MM-DD",
    timeFormat: "24h",
    weekStartsOn: 1,
    defaultDurationUnit: "minutes",
    resultScale: [{ label: "A", value: 4 }, { label: "B", value: 3 }, { label: "C", value: 2 }, { label: "D", value: 1 }],
    measurements: [
      { key: "recall", name: "Recall score", min: 0, max: 10, unit: "/10" },
      { key: "accuracy", name: "Accuracy", min: 0, max: 100, unit: "%" },
      { key: "completion", name: "Completion", min: 0, max: 100, unit: "%" },
    ],
    kinds: ["Study", "Recall", "Revision", "Practice", "Test", "Reading", "Research", "Writing"],
    recallKinds: ["Recall", "Revision", "Test"],
    performance: { includeResult: true, resultWeight: 1, measurementWeights: {} },
    targets: [],
    neglect: { defaultThresholdDays: 7 },
    recall: { srsEnabled: false, intervals: [1, 3, 7, 14, 30, 60] },
    dashboard: { mode: "simple", defaultRange: "last30", visibility: defaultVisibility(), metrics: [...DEFAULT_METRICS] },
    charts: { movingAverageWindow: 7 },
    activityWatch: { enabled: false, url: "http://localhost:5600", syncDays: 14, rules: [] },
    backup: { auto: true, intervalDays: 1, keep: 14, lastBackupAt: null },
  };
}

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Fills in any keys missing from saved data with defaults (recursively for objects; arrays are taken as saved). */
export function deepMerge<T>(defaults: T, saved: unknown): T {
  if (!isPlain(defaults) || !isPlain(saved)) return (saved === undefined || saved === null || typeof saved !== typeof defaults ? defaults : (saved as T));
  const out: Record<string, unknown> = { ...defaults };
  for (const k of Object.keys(saved)) out[k] = k in defaults ? deepMerge((defaults as Record<string, unknown>)[k], saved[k]) : saved[k];
  return out as T;
}

export function loadSettings(saved: unknown, today: string): TrackerSettings {
  const defaults = createDefaultSettings(today);
  if (!isPlain(saved)) return defaults;
  const mig = migrateRecord({ ...saved, v: typeof saved.schemaVersion === "number" ? saved.schemaVersion : 1 }, SETTINGS_SCHEMA_VERSION, SETTINGS_MIGRATIONS);
  if (!mig.ok) return { ...defaults, ...saved } as TrackerSettings; // newer than we understand: keep as-is, do not drop keys
  const rec = { ...mig.record };
  delete rec.v;
  const merged = deepMerge(defaults, rec);
  if (Array.isArray((rec as { tree?: unknown }).tree)) merged.tree = (rec as { tree: SubjectNode[] }).tree;
  merged.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
}

/** After a subject is renamed, keep every setting that points at its old path (targets, AW rules, default category) valid. */
export function applyRenameToSettings(s: TrackerSettings, from: string[], to: string[]): void {
  const fix = (p: string[]): string[] => (p.length >= from.length && from.every((x, i) => p[i] === x) ? [...to, ...p.slice(from.length)] : p);
  for (const t of s.targets) t.path = fix(t.path);
  for (const r of s.activityWatch.rules) r.path = fix(r.path);
  if (from.length === 1 && s.defaultCategory === from[0]) s.defaultCategory = to[0];
}

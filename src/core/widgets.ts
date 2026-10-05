/**
 * Dashboard widget registry. Every section/chart on the dashboard is a widget with an id. Visibility is stored per
 * view mode, so Simple and Advanced keep independent layouts. Hidden widgets are never deleted — they stay listed in
 * Settings and in the Customize window so they can be switched back on at any time.
 */
export type ViewMode = "simple" | "advanced";
export type WidgetGroup = "Overview" | "Charts" | "Analysis";
export interface WidgetDef { id: string; label: string; group: WidgetGroup; description: string; simple: boolean; advanced: boolean }

export const WIDGETS: WidgetDef[] = [
  { id: "today", label: "Today", group: "Overview", description: "Time tracked today, your streak and goal progress", simple: true, advanced: true },
  { id: "week", label: "This week", group: "Overview", description: "Colourful day-by-day bars for the current week", simple: true, advanced: true },
  { id: "goals", label: "Goals", group: "Overview", description: "Progress towards the targets you set", simple: true, advanced: true },
  { id: "breakdown", label: "Where your time goes", group: "Overview", description: "Time per category and subject", simple: true, advanced: true },
  { id: "comparison", label: "Compared with before", group: "Overview", description: "This period against the one before it", simple: true, advanced: true },
  { id: "attention", label: "Needs attention", group: "Overview", description: "Subjects you haven't touched for a while", simple: true, advanced: true },
  { id: "recent", label: "Recent activity", group: "Overview", description: "Last 7, 14 and 30 days at a glance", simple: false, advanced: true },
  { id: "chartActivity", label: "Activity over time", group: "Charts", description: "Daily, weekly or monthly bars with a moving average", simple: false, advanced: true },
  { id: "chartWeekly", label: "Weekly activity", group: "Charts", description: "The last 12 weeks", simple: false, advanced: true },
  { id: "chartMonthly", label: "Monthly activity", group: "Charts", description: "The last 12 months", simple: false, advanced: true },
  { id: "chartDistribution", label: "Distribution", group: "Charts", description: "Share of time per category and subject", simple: false, advanced: true },
  { id: "chartCumulative", label: "Cumulative time", group: "Charts", description: "Running total, this period against the previous one", simple: false, advanced: true },
  { id: "chartPlanned", label: "Planned vs actual", group: "Charts", description: "Sessions that had a planned time", simple: false, advanced: true },
  { id: "keyNumbers", label: "Key numbers", group: "Analysis", description: "Consistency, averages, median, gaps, trend and more", simple: false, advanced: true },
  { id: "longestSessions", label: "Longest sessions", group: "Analysis", description: "Your five longest sessions in the range", simple: false, advanced: true },
  { id: "longestGaps", label: "Longest gaps", group: "Analysis", description: "Longest stretches without activity", simple: false, advanced: true },
  { id: "peaks", label: "Peaks", group: "Analysis", description: "Best day, weekday and time of day", simple: false, advanced: true },
  { id: "results", label: "Results & grades", group: "Analysis", description: "Your grades, scores and the optional performance index", simple: false, advanced: true },
  { id: "recall", label: "Recall & revision", group: "Analysis", description: "Recall sessions, frequency and what is due for review", simple: false, advanced: true },
];

export const SIMPLE_ORDER = ["today", "week", "goals", "comparison", "breakdown", "attention"];
export const ADVANCED_ORDER = ["today", "recent", "attention", "goals", "breakdown", "week", "comparison", "keyNumbers", "chartActivity", "chartWeekly", "chartMonthly", "chartDistribution", "chartCumulative", "chartPlanned", "longestSessions", "longestGaps", "peaks", "results", "recall"];

export type Visibility = Record<ViewMode, Record<string, boolean>>;

export const defaultVisible = (mode: ViewMode, id: string): boolean => WIDGETS.find((w) => w.id === id)?.[mode] ?? false;

export function defaultVisibility(): Visibility {
  const out: Visibility = { simple: {}, advanced: {} };
  for (const w of WIDGETS) { out.simple[w.id] = w.simple; out.advanced[w.id] = w.advanced; }
  return out;
}

/** A missing entry (e.g. a widget added in a newer version) falls back to that widget's default for the mode. */
export const isVisible = (v: Partial<Visibility> | undefined, mode: ViewMode, id: string): boolean => v?.[mode]?.[id] ?? defaultVisible(mode, id);

/** Widgets the user switched off even though they are on by default — used for the "restore" hint. */
export const hiddenByUser = (v: Partial<Visibility> | undefined, mode: ViewMode): WidgetDef[] => WIDGETS.filter((w) => w[mode] && !isVisible(v, mode, w.id));

const LEGACY: Record<string, string[]> = {
  today: ["today"], recent: ["recent"], neglected: ["attention"], categories: ["breakdown"], targets: ["goals"], recall: ["recall"],
  analytics: ["keyNumbers", "comparison", "chartActivity", "chartWeekly", "chartMonthly", "chartDistribution", "chartCumulative", "chartPlanned", "longestSessions", "longestGaps", "peaks", "results"],
};
/** Settings schema v1 had on/off flags per large section; translate them to per-widget visibility. */
export function legacySectionsToVisibility(sections: Record<string, unknown>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, ids] of Object.entries(LEGACY)) if (typeof sections[k] === "boolean") for (const id of ids) out[id] = sections[k] as boolean;
  return out;
}

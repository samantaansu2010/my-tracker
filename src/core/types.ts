/** Shared types. Nothing in src/core imports from "obsidian". */
export const EVENT_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 2;

/** One raw activity record. Raw events are never aggregated in place; all statistics are derived. */
export interface TrackerEvent {
  id: string;
  /** ISO-8601 in the user's local time with offset, e.g. 2026-09-29T05:10:00+05:30 */
  timestamp: string;
  /** Local calendar date (YYYY-MM-DD) at the time of entry. All day-based queries use this field. */
  date: string;
  /** Canonical hierarchy: [category, subject, subsubject, topic, ...deeper] (length >= 1). */
  path: string[];
  durationMinutes: number;
  kind?: string;
  result?: string;
  scores?: Record<string, number>;
  plannedMinutes?: number;
  tags: string[];
  notes: string;
  source: string;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
  /** Unknown fields found in stored data are preserved here rather than discarded. */
  extra?: Record<string, unknown>;
}

export const categoryOf = (e: { path: string[] }): string => e.path[0] ?? "";
export const subjectOf = (e: { path: string[] }): string | undefined => e.path[1];
export const subsubjectOf = (e: { path: string[] }): string | undefined => e.path[2];
export const topicOf = (e: { path: string[] }): string | undefined => e.path[3];

export interface SubjectNode {
  id: string;
  name: string;
  aliases: string[];
  children: SubjectNode[];
  /** intentional: never flag as neglected. temporary: not flagged until pausedUntil (if set). */
  inactive?: "intentional" | "temporary";
  pausedUntil?: string;
  neglectDays?: number;
  /** Optional colour name from the palette; descendants inherit it. */
  color?: string;
}

export interface ResultScaleItem { label: string; value: number }
export interface MeasurementDef { key: string; name: string; min: number; max: number; unit: string }
export interface Target { id: string; path: string[]; minutes: number; period: "day" | "week" | "month" }
export interface AwRule { field: "app" | "title"; pattern: string; regex: boolean; path: string[] }

export type RangeId =
  | "today" | "yesterday" | "last7" | "last14" | "last30" | "last90" | "lastN"
  | "thisWeek" | "prevWeek" | "thisMonth" | "prevMonth" | "thisYear" | "prevYear"
  | "sinceJan1" | "sinceInstall" | "custom";

export interface RangeSpec { id: RangeId; n?: number; custom?: { start: string; end: string } }

export type MetricId = string;

export interface TrackerSettings {
  schemaVersion: number;
  setupComplete: boolean;
  rootFolder: string;
  installDate: string;
  tree: SubjectNode[];
  defaultCategory: string;
  dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "MM/DD/YYYY" | "D MMM YYYY";
  timeFormat: "24h" | "12h";
  weekStartsOn: number;
  defaultDurationUnit: "minutes" | "hours";
  resultScale: ResultScaleItem[];
  measurements: MeasurementDef[];
  kinds: string[];
  recallKinds: string[];
  performance: { includeResult: boolean; resultWeight: number; measurementWeights: Record<string, number> };
  targets: Target[];
  neglect: { defaultThresholdDays: number };
  recall: { srsEnabled: boolean; intervals: number[] };
  dashboard: {
    /** simple: calm overview for everyone · advanced: the full analytics experience */
    mode: "simple" | "advanced";
    defaultRange: RangeId;
    /** Per view mode, which widgets are shown (see core/widgets.ts). Hidden widgets stay available in Settings. */
    visibility: { simple: Record<string, boolean>; advanced: Record<string, boolean> };
    metrics: MetricId[];
  };
  charts: { movingAverageWindow: number };
  activityWatch: { enabled: boolean; url: string; syncDays: number; rules: AwRule[] };
  backup: { auto: boolean; intervalDays: number; keep: number; lastBackupAt: string | null };
}

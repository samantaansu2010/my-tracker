/** "Log again" suggestions derived from past events. Nothing extra is stored. */
import type { TrackerEvent } from "./types";
import { SEP } from "./hierarchy";

export interface RecentEntry {
  key: string; path: string[]; durationMinutes: number; kind?: string; result?: string; plannedMinutes?: number; tags: string[];
  /** how many times this exact combination has been logged */
  count: number; lastTimestamp: string;
}

/**
 * The most recently used distinct entries (same subject path, duration, type, result, planned time and tags).
 * Notes and measurement scores are per-session and are deliberately not repeated. Daily totals imported from
 * integrations are not "sessions you typed", so they are skipped.
 */
export function recentEntries(events: TrackerEvent[], opts: { limit?: number } = {}): RecentEntry[] {
  const limit = opts.limit ?? 6;
  const groups = new Map<string, RecentEntry>();
  for (const e of events) {
    if (e.source === "activitywatch") continue;
    const tags = [...e.tags].sort();
    const key = [e.path.join(SEP), e.durationMinutes, e.kind ?? "", e.result ?? "", e.plannedMinutes ?? "", tags.join(",")].join("|");
    const g = groups.get(key);
    if (g) { g.count++; if (e.timestamp > g.lastTimestamp) g.lastTimestamp = e.timestamp; }
    else groups.set(key, { key, path: e.path, durationMinutes: e.durationMinutes, kind: e.kind, result: e.result, plannedMinutes: e.plannedMinutes, tags, count: 1, lastTimestamp: e.timestamp });
  }
  return [...groups.values()].sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp) || b.count - a.count).slice(0, Math.max(0, limit));
}

import type { SubjectNode, TrackerEvent } from "./types";
import { diffDays, type DateKey } from "./dates";
import { flatten, pathKey } from "./hierarchy";
import { rollup } from "./stats";

export type NeglectStatus = "neglected" | "ok" | "intentional" | "temporary" | "never";
export interface NeglectItem { path: string[]; lastDate: DateKey | null; daysSince: number | null; threshold: number; status: NeglectStatus }

/**
 * Evaluates subject-level nodes (depth 2) plus any node with its own threshold.
 * intentional = user marked "not tracking on purpose"; temporary = paused (until pausedUntil, if set);
 * never = no events yet (not counted as neglected); neglected = last activity older than the threshold.
 */
export function evaluateNeglect(tree: SubjectNode[], events: TrackerEvent[], today: DateKey, defaultThresholdDays: number): NeglectItem[] {
  const roll = rollup(events.filter((e) => e.date <= today));
  const items: NeglectItem[] = [];
  for (const { node, path } of flatten(tree)) {
    if (path.length !== 2 && node.neglectDays === undefined) continue;
    const threshold = node.neglectDays ?? defaultThresholdDays;
    const lastDate = roll.get(pathKey(path))?.lastDate ?? null;
    const daysSince = lastDate ? diffDays(lastDate, today) : null;
    let status: NeglectStatus;
    if (node.inactive === "intentional") status = "intentional";
    else if (node.inactive === "temporary" && (!node.pausedUntil || node.pausedUntil >= today)) status = "temporary";
    else if (daysSince === null) status = "never";
    else status = daysSince > threshold ? "neglected" : "ok";
    items.push({ path, lastDate, daysSince, threshold, status });
  }
  const rank: Record<NeglectStatus, number> = { neglected: 0, ok: 1, temporary: 2, intentional: 3, never: 4 };
  return items.sort((a, b) => rank[a.status] - rank[b.status] || (b.daysSince ?? -1) - (a.daysSince ?? -1));
}

import type { TrackerEvent } from "./types";
import { formatLocalIso } from "./dates";

export const isScheduled = (event: { status?: string }): boolean => event.status === "scheduled";
export const isCompleted = (event: { status?: string }): boolean => event.status !== "scheduled";

export function isOverdue(event: TrackerEvent, now: Date): boolean {
  if (!isScheduled(event)) return false;
  const start = Date.parse(event.timestamp);
  return Number.isFinite(start) && start + event.durationMinutes * 60_000 <= now.getTime();
}

export const plannedOnCompletion = (scheduled: Pick<TrackerEvent, "durationMinutes">, explicit?: number): number =>
  explicit ?? scheduled.durationMinutes;

/** Metric registry: add a metric by adding one entry. Each has a plain-language definition shown in settings. */
import type { Stats } from "./stats";
import { formatDuration, formatPercent } from "./duration";

export interface MetricDef { id: string; label: string; definition: string; format: (s: Stats) => string }
const dash = "–";

export const METRICS: MetricDef[] = [
  { id: "total", label: "Total time", definition: "Sum of all event durations in the range.", format: (s) => formatDuration(s.totalMinutes) },
  { id: "sessions", label: "Sessions", definition: "Number of events in the range.", format: (s) => String(s.sessions) },
  { id: "activeDays", label: "Active days", definition: "Distinct calendar days with at least one event, out of the days elapsed so far.", format: (s) => `${s.activeDays}/${s.calendarDays}` },
  { id: "consistency", label: "Consistency", definition: "Active days ÷ elapsed calendar days.", format: (s) => formatPercent(s.consistency) },
  { id: "avgPerCalendarDay", label: "Avg / calendar day", definition: "Total ÷ elapsed calendar days (idle days count as zero).", format: (s) => (s.avgPerCalendarDay === null ? dash : formatDuration(s.avgPerCalendarDay)) },
  { id: "avgPerActiveDay", label: "Avg / active day", definition: "Total ÷ active days (idle days excluded).", format: (s) => (s.avgPerActiveDay === null ? dash : formatDuration(s.avgPerActiveDay)) },
  { id: "avgSession", label: "Avg session", definition: "Total ÷ number of sessions.", format: (s) => (s.avgSession === null ? dash : formatDuration(s.avgSession)) },
  { id: "medianSession", label: "Median session", definition: "Middle session duration (mean of the two middle values for an even count).", format: (s) => (s.medianSession === null ? dash : formatDuration(s.medianSession)) },
  { id: "longestSession", label: "Longest session", definition: "Largest single event duration.", format: (s) => (s.longestSession ? formatDuration(s.longestSession.durationMinutes) : dash) },
  { id: "shortestSession", label: "Shortest session", definition: "Smallest single event duration.", format: (s) => (s.shortestSession ? formatDuration(s.shortestSession.durationMinutes) : dash) },
  { id: "longestGap", label: "Longest gap", definition: "Most fully idle days between two consecutive active days in the range.", format: (s) => (s.longestGap ? `${s.longestGap.days}d` : "0d") },
  { id: "daysSinceLast", label: "Last activity", definition: "Days between the most recent event in the range and today.", format: (s) => (s.daysSinceLast === null ? dash : s.daysSinceLast === 0 ? "Today" : `${s.daysSinceLast}d ago`) },
  { id: "weeklyAverage", label: "Weekly average", definition: "Average per calendar day × 7 (a rate, not a count of weeks).", format: (s) => (s.weeklyAverage === null ? dash : formatDuration(s.weeklyAverage)) },
  { id: "monthlyAverage", label: "Monthly average", definition: "Average per calendar day × 30.44 (a rate).", format: (s) => (s.monthlyAverage === null ? dash : formatDuration(s.monthlyAverage)) },
  { id: "streak", label: "Streak", definition: "Consecutive active days ending now (longest in range shown after the slash).", format: (s) => `${s.currentStreak}d / ${s.longestStreak}d` },
  { id: "trend", label: "Trend", definition: "Least-squares slope of daily minutes. Needs at least 7 days and 3 active days. Called steady if the fitted change over the range is under 10% of the average day.", format: (s) => { if (s.trend.status !== "ok") return "not enough data"; const w = s.trend.weeklyChangeMinutes!; const word = s.trend.direction === "up" ? "▲ Rising" : s.trend.direction === "down" ? "▼ Falling" : "▬ Steady"; return s.trend.direction === "flat" ? word : `${word} · ${w >= 0 ? "+" : "−"}${formatDuration(Math.abs(w))}/day each week`; } },
  { id: "peakDay", label: "Peak day", definition: "Date with the most total time.", format: (s) => (s.peakDay ? `${s.peakDay.date} · ${formatDuration(s.peakDay.minutes)}` : dash) },
  { id: "peakPeriod", label: "Peak time of day", definition: "Part of the day (by session start time) with the most time. Imported daily aggregates are excluded.", format: (s) => s.peakPeriod?.label ?? dash },
];
export const metricById = (id: string): MetricDef | undefined => METRICS.find((m) => m.id === id);

/** Markdown report for a period. Uses Obsidian-style frontmatter properties so reports are queryable. */
import type { SubjectNode, TrackerEvent } from "./types";
import { formatDuration, formatPercent, formatPercentChange, formatSignedDuration } from "./duration";
import { previousRange, type DateRange } from "./dates";
import { compareStats } from "./compare";
import { computeStats, distribution, filterByRange } from "./stats";
import { metricById } from "./metrics";
import { rollup } from "./stats";
import { flatten, pathLabel } from "./hierarchy";

export function buildReport(range: DateRange, events: TrackerEvent[], tree: SubjectNode[], today: string, metricIds: string[]): string {
  const cur = computeStats(events, range, today);
  const prevRange = previousRange(range, today, true);
  const prev = computeStats(events, prevRange, today);
  const cmp = compareStats(cur, prev);
  const inRange = filterByRange(events, range.start, range.end > today ? today : range.end);
  const lines: string[] = [
    "---", "type: my-tracker-report", `period: "${range.label}"`, `start: ${range.start}`, `end: ${range.end}`,
    `total_minutes: ${Math.round(cur.totalMinutes)}`, `sessions: ${cur.sessions}`, `active_days: ${cur.activeDays}`, "---", "",
    `# ${range.label} (${range.start} → ${range.end})`, "",
    "## Summary", "",
    ...metricIds.map((id) => metricById(id)).filter((m): m is NonNullable<typeof m> => !!m).map((m) => `- **${m.label}:** ${m.format(cur)}`), "",
    `## Versus ${prevRange.label} (${prevRange.start} → ${prevRange.end})`, "",
    `- Time: ${formatDuration(cmp.minutes.current)} vs ${formatDuration(cmp.minutes.previous)} (${formatSignedDuration(cmp.minutes.diff ?? 0)}, ${cmp.minutes.kind === "pct" ? formatPercentChange(cmp.minutes.pct) : cmp.minutes.kind === "new" ? "new activity" : "no change data"})`,
    `- Sessions: ${cur.sessions} vs ${prev.sessions}`,
    `- Active days: ${cur.activeDays} vs ${prev.activeDays}`,
    `- Average per day: ${formatDuration(cur.avgPerCalendarDay)} vs ${formatDuration(prev.avgPerCalendarDay)}`,
    `- Consistency: ${formatPercent(cur.consistency)} vs ${formatPercent(prev.consistency)}`, "",
    "## Breakdown", "", "| Subject | Time | Share | Sessions |", "|---|---:|---:|---:|",
  ];
  for (const s of distribution(inRange, [])) {
    lines.push(`| **${s.name}** | ${formatDuration(s.minutes)} | ${formatPercent(s.share)} | ${s.sessions} |`);
    for (const c of distribution(inRange, s.path)) if (c.name !== "(direct)") lines.push(`| ${pathLabel([...s.path.slice(0, 0), "  " + c.name])} | ${formatDuration(c.minutes)} | ${formatPercent(c.share)} | ${c.sessions} |`);
  }
  const roll = rollup(inRange);
  const deep = flatten(tree).filter((f) => f.path.length >= 3 && (roll.get(f.path.join("\u001f"))?.minutes ?? 0) > 0);
  if (deep.length) { lines.push("", "## Detail", ""); for (const f of deep) lines.push(`- ${pathLabel(f.path)}: ${formatDuration(roll.get(f.path.join("\u001f"))!.minutes)}`); }
  return lines.join("\n") + "\n";
}

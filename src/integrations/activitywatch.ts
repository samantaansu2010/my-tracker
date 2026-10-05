/**
 * Optional ActivityWatch integration (https://activitywatch.net), talking only to the user's local server.
 * AFK time is excluded using the AFK watcher. Events are summed per (day, mapped path) into ONE daily record each,
 * keyed by externalId so re-syncing updates rather than duplicates.
 */
import type { AwRule } from "../core/types";
import { addDays, formatLocalIso, parseDateKey, toDateKey, type DateKey } from "../core/dates";
import { pathKey } from "../core/hierarchy";

export interface AwEvent { timestamp: string; duration: number; data: { app?: string; title?: string } }
export interface AwDaily { date: DateKey; path: string[]; minutes: number; externalId: string }
export type HttpFn = (req: { url: string; method: "GET" | "POST"; body?: string }) => Promise<{ status: number; json: unknown }>;

export const DEFAULT_AW_BASE = ["Technology", "Computer"];

/** Splits [start, start+seconds) at LOCAL midnights so an event spanning midnight is credited to both days. */
export function splitAcrossDays(startMs: number, seconds: number): { date: DateKey; seconds: number }[] {
  const out: { date: DateKey; seconds: number }[] = [];
  let cur = startMs, remaining = seconds;
  while (remaining > 1e-9) {
    const d = new Date(cur);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const take = Math.min(remaining, (nextMidnight - cur) / 1000);
    out.push({ date: toDateKey(d), seconds: take });
    cur += take * 1000; remaining -= take;
  }
  return out;
}

export function mapEvent(ev: AwEvent, rules: AwRule[], base: string[] = DEFAULT_AW_BASE): string[] {
  const app = (ev.data.app ?? "").trim() || "Unknown";
  for (const r of rules) {
    const target = r.field === "app" ? app : ev.data.title ?? "";
    let hit = false;
    try { hit = r.regex ? new RegExp(r.pattern, "i").test(target) : target.toLowerCase().includes(r.pattern.toLowerCase()); } catch { hit = false; }
    if (hit && r.path.length) return r.path;
  }
  return [...base, app.replace(/\.exe$/i, "")];
}

export function aggregateAw(events: AwEvent[], rules: AwRule[], base: string[] = DEFAULT_AW_BASE): AwDaily[] {
  const acc = new Map<string, { date: DateKey; path: string[]; seconds: number }>();
  for (const ev of events) {
    const startMs = Date.parse(ev.timestamp);
    if (!Number.isFinite(startMs) || !(ev.duration > 0)) continue;
    const path = mapEvent(ev, rules, base);
    for (const part of splitAcrossDays(startMs, ev.duration)) {
      const k = `${part.date}|${pathKey(path)}`;
      const cur = acc.get(k) ?? { date: part.date, path, seconds: 0 };
      cur.seconds += part.seconds;
      acc.set(k, cur);
    }
  }
  return [...acc.values()].filter((a) => a.seconds >= 30).map((a) => ({ date: a.date, path: a.path, minutes: Math.min(1440, a.seconds / 60), externalId: `aw:${a.date}:${pathKey(a.path)}` })).sort((a, b) => a.date.localeCompare(b.date) || a.externalId.localeCompare(b.externalId));
}

const QUERY_WITH_AFK = [
  'events = flood(query_bucket(find_bucket("aw-watcher-window_")));',
  'afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));',
  'afk = filter_keyvals(afk, "status", ["not-afk"]);',
  "events = filter_period_intersect(events, afk);",
  "RETURN = sort_by_timestamp(events);",
];
const QUERY_NO_AFK = QUERY_WITH_AFK.filter((l) => !l.includes("afk")).map((l) => l);

export async function testConnection(http: HttpFn, baseUrl: string): Promise<string> {
  const r = await http({ url: `${baseUrl.replace(/\/$/, "")}/api/0/info`, method: "GET" });
  if (r.status !== 200) throw new Error(`ActivityWatch responded with HTTP ${r.status}`);
  const v = (r.json as { version?: string })?.version;
  return v ? `Connected to ActivityWatch ${v}` : "Connected to ActivityWatch";
}

/** Fetches non-AFK window events for [startDate, endDate] (local days, inclusive). */
export async function fetchWindowEvents(http: HttpFn, baseUrl: string, startDate: DateKey, endDate: DateKey): Promise<AwEvent[]> {
  const s = parseDateKey(startDate), e = parseDateKey(addDays(endDate, 1));
  const period = `${formatLocalIso(new Date(s.y, s.m - 1, s.d))}/${formatLocalIso(new Date(e.y, e.m - 1, e.d))}`;
  const run = async (query: string[]) => http({ url: `${baseUrl.replace(/\/$/, "")}/api/0/query/`, method: "POST", body: JSON.stringify({ timeperiods: [period], query }) });
  let r = await run(QUERY_WITH_AFK);
  if (r.status >= 400) r = await run(QUERY_NO_AFK); // no AFK watcher installed
  if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`ActivityWatch query failed (HTTP ${r.status})`);
  return (r.json[0] ?? []) as AwEvent[];
}

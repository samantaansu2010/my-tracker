/** Local natural-language entry parser: "Math Algebra 45m A #exam @14:30 - notes". No network, no LLM. */
import type { MeasurementDef, ResultScaleItem, SubjectNode } from "./types";
import { extractDuration, parseDuration, splitCompound } from "./duration";
import { formatLocalIso, isDateKey, parseDateKey, toDateKey, addDays } from "./dates";
import { buildIndex, canonicalizePath, findNode, isPrefixPath, rankNodes, type IndexEntry } from "./hierarchy";
import { normalize, titleCase } from "./text";

export interface ParseContext {
  tree: SubjectNode[];
  resultScale: ResultScaleItem[];
  kinds: string[];
  measurements: MeasurementDef[];
  now: Date;
  defaultCategory: string;
  defaultDurationUnit: "minutes" | "hours";
}

export interface ParsedEntry {
  raw: string;
  path: string[];
  /** Number of leading path segments that already exist in the subject tree (the rest will be created on save). */
  existingDepth: number;
  durationMinutes: number | null;
  plannedMinutes?: number;
  result?: string;
  scores: Record<string, number>;
  kind?: string;
  tags: string[];
  notes: string;
  timestamp: string;
  date: string;
  leftover: string[];
  warnings: string[];
  errors: string[];
}

const TIME_RE = /^@(\d{1,2})(?::(\d{2}))?(am|pm)?$/i;

export interface Resolution { anchor: IndexEntry | null; used: boolean[] }

/** Matches subject names/aliases (multi-word, fuzzy) inside a token list and picks the deepest consistent chain. */
export function resolveTokens(tokens: string[], index: IndexEntry[]): Resolution {
  const used = new Array<boolean>(tokens.length).fill(false);
  interface M { start: number; len: number; cands: { entry: IndexEntry; score: number }[] }
  const matches: M[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: M | null = null;
    for (let n = Math.min(4, tokens.length - i); n >= 1 && !found; n--) {
      const ranked = rankNodes(tokens.slice(i, i + n).join(" "), index, { minScore: 60, minPrefix: 3 });
      if (ranked.length) found = { start: i, len: n, cands: ranked.filter((r) => r.score >= ranked[0].score - 5) };
    }
    if (found) { matches.push(found); i += found.len; } else i++;
  }
  if (!matches.length) return { anchor: null, used };
  let best: { entry: IndexEntry; m: M; covered: M[] } | null = null;
  let bestScore = -1;
  for (const m of matches) {
    for (const c of m.cands) {
      const covered = matches.filter((o) => o !== m && o.cands.some((oc) => isPrefixPath(oc.entry.path, c.entry.path)));
      const s = covered.length * 1000 + c.entry.path.length * 10 + c.score / 10;
      if (s > bestScore) { bestScore = s; best = { entry: c.entry, m, covered }; }
    }
  }
  for (const m of [best!.m, ...best!.covered]) for (let k = m.start; k < m.start + m.len; k++) used[k] = true;
  return { anchor: best!.entry, used };
}

function matchScale(label: string, scale: ResultScaleItem[], caseInsensitive: boolean): string | undefined {
  return scale.find((s) => (caseInsensitive ? s.label.toLowerCase() === label.toLowerCase() : s.label === label))?.label;
}

export function parseScoreValue(raw: string, def: MeasurementDef): number | null {
  const m = /^(-?\d+(?:\.\d+)?)(%|\/(\d+(?:\.\d+)?))?$/.exec(raw.replace(",", "."));
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[3]) { const denom = parseFloat(m[3]); if (!(denom > 0)) return null; v = (v / denom) * def.max; }
  else if (m[2] === "%" && def.unit !== "%") v = def.min + (v / 100) * (def.max - def.min);
  return v >= def.min && v <= def.max ? v : null;
}

export function parseEntry(input: string, ctx: ParseContext): ParsedEntry {
  const warnings: string[] = [], errors: string[] = [];
  let main = input.trim();
  let notes = "";
  const nm = /\s(?:-|\||\/\/)\s|\bnotes?:\s*/i.exec(main);
  if (nm) { notes = main.slice(nm.index + nm[0].length).trim(); main = main.slice(0, nm.index); }
  const tokens = main.replace(/[>›]/g, " ").split(/\s+/).filter(Boolean).flatMap(splitCompound);

  const today = toDateKey(ctx.now);
  const tags: string[] = [];
  const scores: Record<string, number> = {};
  let dateKey: string | undefined, time: { h: number; m: number } | undefined;
  let kind: string | undefined, result: string | undefined, planned: number | undefined;
  const rest: string[] = [];

  for (const t of tokens) {
    if (t.startsWith("#") && t.length > 1) { tags.push(t.slice(1).toLowerCase()); continue; }
    const tm = TIME_RE.exec(t);
    if (tm) {
      let h = parseInt(tm[1], 10); const mi = tm[2] ? parseInt(tm[2], 10) : 0;
      if (tm[3]) { h = h % 12 + (tm[3].toLowerCase() === "pm" ? 12 : 0); }
      if (h < 24 && mi < 60) { time = { h, m: mi }; continue; }
      warnings.push(`Ignored invalid time "${t}"`); continue;
    }
    if (isDateKey(t)) { dateKey = t; continue; }
    const low = t.toLowerCase();
    if (low === "today") { dateKey = today; continue; }
    if (low === "yesterday" || low === "yday") { dateKey = addDays(today, -1); continue; }
    const kv = /^([a-z][\w-]*)[:=](.+)$/i.exec(t);
    if (kv) {
      const key = kv[1].toLowerCase(), val = kv[2];
      if (key === "kind" || key === "k") { kind = ctx.kinds.find((k) => k.toLowerCase() === val.toLowerCase()) ?? val; continue; }
      if (key === "result" || key === "grade" || key === "r") {
        const lab = matchScale(val, ctx.resultScale, true);
        if (lab) result = lab; else warnings.push(`"${val}" is not in the result scale`);
        continue;
      }
      if (key === "planned" || key === "plan") {
        const p = parseDuration(val, ctx.defaultDurationUnit);
        if (p) planned = p; else warnings.push(`Could not read planned time "${val}"`);
        continue;
      }
      const def = ctx.measurements.find((d) => normalize(d.key) === normalize(key) || normalize(d.name).startsWith(normalize(key)));
      if (def) {
        const v = parseScoreValue(val, def);
        if (v === null) warnings.push(`${def.name} must be between ${def.min} and ${def.max}`); else scores[def.key] = v;
        continue;
      }
      rest.push(...t.split(/[:=]/).filter(Boolean));
      continue;
    }
    rest.push(t);
  }

  const span = extractDuration(rest, ctx.defaultDurationUnit);
  let durationMinutes: number | null = null;
  if (span) { durationMinutes = span.minutes; rest.splice(span.start, span.end - span.start); }
  if (durationMinutes !== null && !(durationMinutes > 0)) { errors.push("Duration must be greater than zero"); durationMinutes = null; }
  else if (durationMinutes === null) errors.push("Missing duration (try 45m, 1h 20m or 1:30)");
  else if (durationMinutes > 1440) { errors.push("Duration cannot exceed 24 hours"); durationMinutes = null; }

  if (!result) {
    for (let i = rest.length - 1; i >= 0; i--) {
      const lab = matchScale(rest[i], ctx.resultScale, false) ?? (i === rest.length - 1 && rest.length > 1 ? matchScale(rest[i], ctx.resultScale, true) : undefined);
      if (lab) { result = lab; rest.splice(i, 1); break; }
    }
  }

  const index = buildIndex(ctx.tree);
  if (!kind) {
    for (let i = 0; i < rest.length; i++) {
      const k = ctx.kinds.find((x) => x.toLowerCase() === rest[i].toLowerCase());
      if (k && !rankNodes(rest[i], index, { minScore: 98 }).length) { kind = k; rest.splice(i, 1); break; }
    }
  }

  const { anchor, used } = resolveTokens(rest, index);
  const leftover = rest.filter((_, i) => !used[i]);
  const leftoverText = titleCase(leftover.join(" ").trim());
  let path: string[];
  let existingDepth: number;
  if (anchor) {
    path = [...anchor.path, ...(leftoverText ? [leftoverText] : [])];
    existingDepth = anchor.path.length;
    if (leftoverText) warnings.push(`"${leftoverText}" is new and will be added under ${anchor.path.join(" › ")}`);
  } else if (leftoverText) {
    const cat = canonicalizePath(ctx.tree, [ctx.defaultCategory])[0];
    path = [cat, leftoverText];
    existingDepth = findNode(ctx.tree, [cat]) ? 1 : 0;
    warnings.push(`"${leftoverText}" is a new subject and will be added under ${cat}`);
  } else { path = []; existingDepth = 0; errors.push("Missing subject"); }

  const base = dateKey ? parseDateKey(dateKey) : { y: ctx.now.getFullYear(), m: ctx.now.getMonth() + 1, d: ctx.now.getDate() };
  const at = new Date(base.y, base.m - 1, base.d, time?.h ?? ctx.now.getHours(), time?.m ?? ctx.now.getMinutes(), 0, 0);

  return {
    raw: input, path, existingDepth, durationMinutes, plannedMinutes: planned, result, scores, kind,
    tags: Array.from(new Set(tags)), notes, timestamp: formatLocalIso(at), date: toDateKey(at), leftover, warnings, errors,
  };
}

/** Tiny local question parser: "How much Math did I do in the last 14 days?", "Compare English this month with last month". */
import type { RangeSpec, SubjectNode } from "./types";
import { buildIndex } from "./hierarchy";
import { resolveTokens } from "./parser";

export interface ParsedQuestion { path: string[]; range: RangeSpec; compare: boolean; unresolved: string }

const PHRASES: { re: RegExp; spec: (m: RegExpExecArray) => RangeSpec }[] = [
  { re: /\b(?:last|past)\s+(\d+)\s+days?\b/gi, spec: (m) => ({ id: "lastN", n: parseInt(m[1], 10) }) },
  { re: /\bsince\s+(?:january\s+1(?:st)?|jan\s+1(?:st)?|the\s+start\s+of\s+the\s+year)\b/gi, spec: () => ({ id: "sinceJan1" }) },
  { re: /\bsince\s+(?:installation|install|i\s+installed(?:\s+it)?)\b/gi, spec: () => ({ id: "sinceInstall" }) },
  { re: /\btoday\b/gi, spec: () => ({ id: "today" }) },
  { re: /\byesterday\b/gi, spec: () => ({ id: "yesterday" }) },
  { re: /\bthis\s+week\b/gi, spec: () => ({ id: "thisWeek" }) },
  { re: /\b(?:previous|last)\s+week\b/gi, spec: () => ({ id: "prevWeek" }) },
  { re: /\bthis\s+month\b/gi, spec: () => ({ id: "thisMonth" }) },
  { re: /\b(?:previous|last)\s+month\b/gi, spec: () => ({ id: "prevMonth" }) },
  { re: /\bthis\s+year\b/gi, spec: () => ({ id: "thisYear" }) },
  { re: /\b(?:previous|last)\s+year\b/gi, spec: () => ({ id: "prevYear" }) },
];
const STOP = new Set("how much many did do i does my me the a an in of on for to with and vs versus time spent spend study studied work worked have had what was is were are total hours minutes compare comparison this last previous past days day activity".split(" "));

export function parseQuestion(text: string, tree: SubjectNode[]): ParsedQuestion {
  let rest = text.replace(/[?!.,]/g, " ");
  const found: { index: number; spec: RangeSpec }[] = [];
  for (const p of PHRASES) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(rest))) found.push({ index: m.index, spec: p.spec(m) });
    rest = rest.replace(p.re, " ");
  }
  found.sort((a, b) => a.index - b.index);
  const compare = /\bcompare\b|\bvs\.?\b|\bversus\b/i.test(text);
  const tokens = rest.replace(/[>›]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t.toLowerCase()));
  const { anchor, used } = resolveTokens(tokens, buildIndex(tree));
  return {
    path: anchor?.path ?? [],
    range: found[0]?.spec ?? { id: "last30" },
    compare,
    unresolved: tokens.filter((_, i) => !used[i]).join(" "),
  };
}

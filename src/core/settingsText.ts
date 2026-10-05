/** Parsing/serialising of the multi-line text fields in the settings screen. Pure so they can be tested. */
import type { AwRule, MeasurementDef, ResultScaleItem } from "./types";

export function parseResultScale(text: string): { value: ResultScaleItem[]; error?: string } {
  const out: ResultScaleItem[] = [];
  for (const part of text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*=\s*(-?\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return { value: [], error: `"${part}" should look like A=4` };
    if (out.some((x) => x.label === m[1])) return { value: [], error: `Duplicate label "${m[1]}"` };
    out.push({ label: m[1], value: parseFloat(m[2]) });
  }
  if (!out.length) return { value: [], error: "Add at least one grade" };
  return { value: out };
}
export const serializeResultScale = (s: ResultScaleItem[]): string => s.map((x) => `${x.label}=${x.value}`).join(", ");

export function parseMeasurements(text: string): { value: MeasurementDef[]; error?: string } {
  const out: MeasurementDef[] = [];
  for (const line of text.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const [key, name, min, max, unit = ""] = line.split("|").map((s) => s.trim());
    const lo = Number(min), hi = Number(max);
    if (!key || !name || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { value: [], error: `"${line}" should look like recall|Recall score|0|10|/10 (max must exceed min)` };
    if (!/^[a-z][\w-]*$/i.test(key)) return { value: [], error: `Key "${key}" must be one word (letters, digits, - or _)` };
    if (out.some((x) => x.key.toLowerCase() === key.toLowerCase())) return { value: [], error: `Duplicate key "${key}"` };
    out.push({ key, name, min: lo, max: hi, unit });
  }
  return { value: out };
}
export const serializeMeasurements = (m: MeasurementDef[]): string => m.map((d) => `${d.key}|${d.name}|${d.min}|${d.max}|${d.unit}`).join("\n");

export function parseWeights(text: string): { value: Record<string, number>; error?: string } {
  const out: Record<string, number> = {};
  for (const part of text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^([\w-]+)\s*=\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return { value: {}, error: `"${part}" should look like recall=1` };
    out[m[1]] = parseFloat(m[2]);
  }
  return { value: out };
}
export const serializeWeights = (w: Record<string, number>): string => Object.entries(w).map(([k, v]) => `${k}=${v}`).join(", ");

export const parseList = (text: string): string[] => Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));
export function parseIntervals(text: string): { value: number[]; error?: string } {
  const nums = text.split(/[,\s]+/).filter(Boolean).map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < 1)) return { value: [], error: "Use whole numbers of days, e.g. 1, 3, 7, 14" };
  return { value: nums };
}

/** One rule per line: `app | discord | Technology > Discord`; wrap the pattern in /slashes/ for a regular expression. */
export function parseAwRules(text: string): { value: AwRule[]; error?: string } {
  const out: AwRule[] = [];
  for (const line of text.split("\n").map((s) => s.trim()).filter(Boolean)) {
    const [field, pattern, path] = line.split("|").map((s) => s.trim());
    if ((field !== "app" && field !== "title") || !pattern || !path) return { value: [], error: `"${line}" should look like: app | discord | Technology > Discord` };
    const regex = pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/");
    const pat = regex ? pattern.slice(1, -1) : pattern;
    if (regex) { try { new RegExp(pat); } catch { return { value: [], error: `Invalid regular expression in "${line}"` }; } }
    out.push({ field, pattern: pat, regex, path: path.split(/\s*>\s*/).filter(Boolean) });
  }
  return { value: out };
}
export const serializeAwRules = (r: AwRule[]): string => r.map((x) => `${x.field} | ${x.regex ? `/${x.pattern}/` : x.pattern} | ${x.path.join(" > ")}`).join("\n");

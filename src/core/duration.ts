/**
 * Duration handling. Everything is normalised to minutes (a plain number).
 * Accepted: 20m, 20 min, 20 minutes, 1h, 1 hour, 1h 30m, 1h30m, 1.5h, 90m, 01:30, 1:30, and bare numbers
 * (interpreted in the default unit).
 */
const UNIT_MINUTES: Record<string, number> = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60,
};
const UNIT = "h|hr|hrs|hours?|m|mins?|minutes?";
const SEGMENT = new RegExp(`^(\\d+(?:[.,]\\d+)?)(${UNIT})$`, "i");
const COMPOUND = new RegExp(`^(?:\\d+(?:[.,]\\d+)?(?:${UNIT}))+$`, "i");
const COMPOUND_PART = new RegExp(`\\d+(?:[.,]\\d+)?(?:${UNIT})`, "gi");
const HHMM = /^(\d{1,3}):([0-5]\d)$/;
const NUMBER = /^\d+(?:[.,]\d+)?$/;
const UNIT_WORD = new RegExp(`^(?:${UNIT})$`, "i");

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (s: string) => parseFloat(s.replace(",", "."));

/** "1h30m" -> ["1h","30m"]; other tokens are returned unchanged. */
export function splitCompound(token: string): string[] {
  if (!COMPOUND.test(token)) return [token];
  const parts = token.match(COMPOUND_PART) ?? [];
  return parts.length > 1 ? parts : [token];
}

export interface DurationSpan { minutes: number; start: number; end: number }

/** Finds the first duration inside a token list; `end` is exclusive. Tokens must already be whitespace-split. */
export function extractDuration(tokens: string[], defaultUnit: "minutes" | "hours" = "minutes"): DurationSpan | null {
  for (let i = 0; i < tokens.length; i++) {
    let total = 0;
    let j = i;
    let matched = false;
    for (;;) {
      const t = tokens[j];
      if (t === undefined) break;
      const hhmm = !matched ? HHMM.exec(t) : null;
      if (hhmm) { total = parseInt(hhmm[1], 10) * 60 + parseInt(hhmm[2], 10); j++; matched = true; break; }
      const seg = SEGMENT.exec(t);
      if (seg) { total += num(seg[1]) * UNIT_MINUTES[seg[2].toLowerCase()]; j++; matched = true; continue; }
      const next = tokens[j + 1];
      if (NUMBER.test(t) && next !== undefined && UNIT_WORD.test(next)) {
        total += num(t) * UNIT_MINUTES[next.toLowerCase()]; j += 2; matched = true; continue;
      }
      break;
    }
    if (matched) return { minutes: round6(total), start: i, end: j };
  }
  // Fallback: a single bare number in the default unit.
  const bare = tokens.map((t, i) => [t, i] as const).filter(([t]) => NUMBER.test(t));
  if (bare.length === 1) {
    const [t, i] = bare[0];
    return { minutes: round6(num(t) * (defaultUnit === "hours" ? 60 : 1)), start: i, end: i + 1 };
  }
  return null;
}

/** Parses a complete string such as "1h 30m". Returns null unless the whole string is a valid duration > 0. */
export function parseDuration(input: string, defaultUnit: "minutes" | "hours" = "minutes"): number | null {
  const tokens = input.trim().split(/\s+/).flatMap(splitCompound).filter(Boolean);
  if (!tokens.length) return null;
  const span = extractDuration(tokens, defaultUnit);
  if (!span || span.start !== 0 || span.end !== tokens.length || !(span.minutes > 0)) return null;
  return span.minutes;
}

/** 45 -> "45m", 80 -> "1h 20m", 195 -> "3h 15m", 120 -> "2h". Display-only; rounds to whole minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "–";
  if (minutes > 0 && minutes < 1) return "<1m";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatSignedDuration(minutes: number): string {
  const r = Math.round(minutes);
  if (r === 0) return "0m";
  return (r > 0 ? "+" : "−") + formatDuration(Math.abs(r));
}

export const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(2)} h`;

export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction) ? "–" : `${(fraction * 100).toFixed(digits)}%`;
}
export function formatPercentChange(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "–";
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(1)}%`;
}

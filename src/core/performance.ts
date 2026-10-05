/** Results and performance. A grade is the user's own label; nothing here claims to measure ability. */
import type { MeasurementDef, ResultScaleItem, TrackerEvent } from "./types";
import { sum } from "./stats";

/** Maps a grade label onto 0..1 using the configured scale ((v − min) / (max − min)). null if unknown or scale is degenerate. */
export function resultTo01(label: string | undefined, scale: ResultScaleItem[]): number | null {
  if (!label || !scale.length) return null;
  const item = scale.find((s) => s.label === label);
  if (!item) return null;
  const vals = scale.map((s) => s.value), min = Math.min(...vals), max = Math.max(...vals);
  return max > min ? (item.value - min) / (max - min) : null;
}
export const measurementTo01 = (v: number, d: MeasurementDef): number | null => (d.max > d.min ? Math.min(1, Math.max(0, (v - d.min) / (d.max - d.min))) : null);

export interface ResultStats { rated: number; counts: { label: string; count: number }[]; mean01: number | null }
export function resultStats(events: TrackerEvent[], scale: ResultScaleItem[]): ResultStats {
  const counts = scale.map((s) => ({ label: s.label, count: events.filter((e) => e.result === s.label).length }));
  const vals = events.map((e) => resultTo01(e.result, scale)).filter((v): v is number => v !== null);
  return { rated: vals.length, counts, mean01: vals.length ? sum(vals) / vals.length : null };
}

export interface MeasurementStats { def: MeasurementDef; n: number; mean: number | null; min: number | null; max: number | null; latest: number | null }
export function measurementStats(events: TrackerEvent[], defs: MeasurementDef[]): MeasurementStats[] {
  return defs.map((def) => {
    const vals = events.filter((e) => e.scores && typeof e.scores[def.key] === "number").map((e) => e.scores![def.key]);
    return { def, n: vals.length, mean: vals.length ? sum(vals) / vals.length : null, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, latest: vals.length ? vals[vals.length - 1] : null };
  });
}

export interface IndexConfig { includeResult: boolean; resultWeight: number; measurementWeights: Record<string, number> }
export interface IndexComponent { id: string; name: string; mean01: number; weight: number; n: number }
/**
 * Performance index = 100 × Σ(wᵢ · mᵢ) ÷ Σ(wᵢ), where mᵢ is the mean of component i normalised to 0..1 over the sessions
 * that recorded it, and only components with data and weight > 0 participate. null if nothing qualifies.
 */
export function performanceIndex(events: TrackerEvent[], scale: ResultScaleItem[], defs: MeasurementDef[], cfg: IndexConfig): { index: number | null; components: IndexComponent[] } {
  const components: IndexComponent[] = [];
  if (cfg.includeResult && cfg.resultWeight > 0) {
    const r = resultStats(events, scale);
    if (r.mean01 !== null) components.push({ id: "result", name: "Result grade", mean01: r.mean01, weight: cfg.resultWeight, n: r.rated });
  }
  for (const d of defs) {
    const w = cfg.measurementWeights[d.key] ?? 0;
    if (!(w > 0)) continue;
    const vals = events.map((e) => (e.scores && typeof e.scores[d.key] === "number" ? measurementTo01(e.scores[d.key], d) : null)).filter((v): v is number => v !== null);
    if (vals.length) components.push({ id: d.key, name: d.name, mean01: sum(vals) / vals.length, weight: w, n: vals.length });
  }
  const wsum = sum(components.map((c) => c.weight));
  return { index: wsum > 0 ? (100 * sum(components.map((c) => c.weight * c.mean01))) / wsum : null, components };
}

export function describeIndexFormula(cfg: IndexConfig, defs: MeasurementDef[]): string {
  const terms: string[] = [];
  if (cfg.includeResult && cfg.resultWeight > 0) terms.push(`${cfg.resultWeight} × result grade`);
  for (const d of defs) { const w = cfg.measurementWeights[d.key] ?? 0; if (w > 0) terms.push(`${w} × ${d.name} (${d.min}–${d.max})`); }
  return terms.length ? `Index = 100 × (${terms.join(" + ")}) ÷ (sum of weights of components that have data). Each component is the mean over sessions, scaled to 0–1.` : "No components are weighted, so no index is calculated.";
}

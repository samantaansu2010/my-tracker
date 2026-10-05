/** Fuzzy text matching used for subject names, aliases and typo tolerance. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Score 0-100 of how well normalised query `q` matches normalised `key`.
 * 100 exact · 98 equal ignoring spaces · 80-90 prefix · 70 word-prefix · 62/60 one/two typos ·
 * 55 substring · <=52 typo'd prefix. Parsing uses a threshold of 60, autocomplete of ~50.
 */
export function scoreMatch(q: string, key: string, minPrefix = 2): number {
  if (!q || !key) return 0;
  if (q === key) return 100;
  const qc = q.replace(/ /g, ""), kc = key.replace(/ /g, "");
  if (qc === kc) return 98;
  if (qc.length >= minPrefix && kc.startsWith(qc)) return 80 + (10 * qc.length) / kc.length;
  if (qc.length >= minPrefix && key.split(" ").some((w) => w.startsWith(qc))) return 70;
  const maxD = qc.length <= 3 ? 0 : qc.length <= 5 ? 1 : 2;
  if (maxD > 0) {
    const d = editDistance(qc, kc);
    if (d <= maxD) return 65 - 2.5 * d;
  }
  if (qc.length >= 3 && kc.includes(qc)) return 55;
  if (maxD > 0 && qc.length >= 5 && kc.length > qc.length) {
    const dp = editDistance(qc, kc.slice(0, qc.length));
    if (dp <= maxD) return 55 - 5 * dp;
  }
  return 0;
}

export function titleCase(s: string): string {
  return s.split(" ").map((w) => (w === w.toLowerCase() && w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

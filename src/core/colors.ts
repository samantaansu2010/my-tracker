/** Stable, user-overridable colours for subjects. Names map to Obsidian's --color-* CSS variables in the UI. */
import type { SubjectNode } from "./types";
import { normalize } from "./text";

export const PALETTE = ["blue", "green", "orange", "purple", "pink", "cyan", "yellow", "red"] as const;
export type ColorName = (typeof PALETTE)[number];
export const isColorName = (s: unknown): s is ColorName => typeof s === "string" && (PALETTE as readonly string[]).includes(s);

const hash = (s: string): number => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/**
 * Colour of a path: the nearest explicitly coloured node on the way down wins. Otherwise categories take the first
 * palette slots in tree order and subjects take the slots after them (numbered across the whole tree), so a subject
 * never shares a colour with a category or a sibling while the palette lasts. Deeper levels inherit their subject.
 * Paths that aren't in the tree any more get a stable colour from a hash of their name.
 */
export function colorFor(path: string[], tree: SubjectNode[]): ColorName {
  let level = tree, explicit: ColorName | null = null, topIndex = -1, subject: SubjectNode | null = null, found = true;
  path.forEach((seg, depth) => {
    if (!found) return;
    const i = level.findIndex((n) => normalize(n.name) === normalize(seg));
    if (i < 0) { found = false; return; }
    const node = level[i];
    if (depth === 0) topIndex = i;
    if (depth === 1) subject = node;
    if (isColorName(node.color)) explicit = node.color;
    level = node.children;
  });
  if (explicit) return explicit;
  if (!found || topIndex < 0) return PALETTE[hash(path.slice(0, 2).join("/")) % PALETTE.length];
  if (!subject) return PALETTE[topIndex % PALETTE.length];
  let n = 0;
  for (const top of tree) for (const sub of top.children) { if (sub === subject) return PALETTE[(tree.length + n) % PALETTE.length]; n++; }
  return PALETTE[topIndex % PALETTE.length];
}

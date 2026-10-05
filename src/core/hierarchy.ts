/** Subject tree: unlimited nesting, canonical names, aliases, fuzzy lookup. */
import type { SubjectNode } from "./types";
import { newId } from "./ids";
import { normalize, scoreMatch } from "./text";

export const SEP = "\u001f";
export const pathKey = (p: string[]): string => p.join(SEP);
export const pathLabel = (p: string[], sep = " › "): string => p.join(sep);
export const isPrefixPath = (prefix: string[], p: string[]): boolean => prefix.length <= p.length && prefix.every((s, i) => p[i] === s);

export interface FlatNode { node: SubjectNode; path: string[] }

export function flatten(tree: SubjectNode[], prefix: string[] = []): FlatNode[] {
  const out: FlatNode[] = [];
  for (const node of tree) {
    const path = [...prefix, node.name];
    out.push({ node, path }, ...flatten(node.children, path));
  }
  return out;
}

const sameName = (a: string, b: string) => normalize(a) === normalize(b);

export function findNode(tree: SubjectNode[], path: string[]): SubjectNode | null {
  let level = tree;
  let found: SubjectNode | null = null;
  for (const seg of path) {
    found = level.find((n) => sameName(n.name, seg)) ?? null;
    if (!found) return null;
    level = found.children;
  }
  return found;
}

export function makeNode(name: string, aliases: string[] = [], children: SubjectNode[] = []): SubjectNode {
  return { id: newId("sub"), name, aliases, children };
}

/** Maps each segment to the canonical spelling where a node already exists (case/diacritic-insensitive). */
export function canonicalizePath(tree: SubjectNode[], path: string[]): string[] {
  const out: string[] = [];
  let level: SubjectNode[] | null = tree;
  for (const seg of path) {
    const hit: SubjectNode | undefined = level?.find((n) => sameName(n.name, seg));
    out.push(hit ? hit.name : seg.trim());
    level = hit ? hit.children : null;
  }
  return out;
}

/** Creates any missing nodes along `path`. Returns the paths that were created. */
export function ensurePath(tree: SubjectNode[], path: string[]): string[][] {
  const created: string[][] = [];
  let level = tree;
  const acc: string[] = [];
  for (const seg of path) {
    let node = level.find((n) => sameName(n.name, seg));
    if (!node) { node = makeNode(seg.trim()); level.push(node); created.push([...acc, node.name]); }
    acc.push(node.name);
    level = node.children;
  }
  return created;
}

export function removeNode(tree: SubjectNode[], path: string[]): boolean {
  const parent = path.length > 1 ? findNode(tree, path.slice(0, -1)) : null;
  const level = path.length > 1 ? parent?.children : tree;
  if (!level) return false;
  const i = level.findIndex((n) => sameName(n.name, path[path.length - 1]));
  if (i < 0) return false;
  level.splice(i, 1);
  return true;
}

export function renameNode(tree: SubjectNode[], path: string[], newName: string): { ok: true } | { ok: false; error: string } {
  const name = newName.trim();
  if (!name) return { ok: false, error: "Name cannot be empty" };
  if (name.includes(SEP)) return { ok: false, error: "Name contains an invalid character" };
  const node = findNode(tree, path);
  if (!node) return { ok: false, error: "Subject not found" };
  const siblings = path.length > 1 ? findNode(tree, path.slice(0, -1))!.children : tree;
  if (siblings.some((s) => s !== node && sameName(s.name, name))) return { ok: false, error: `"${name}" already exists at this level` };
  node.name = name;
  return { ok: true };
}

export interface IndexEntry { node: SubjectNode; path: string[]; keys: string[] }
export function buildIndex(tree: SubjectNode[]): IndexEntry[] {
  return flatten(tree).map(({ node, path }) => ({ node, path, keys: [node.name, ...node.aliases].map(normalize).filter(Boolean) }));
}

export interface Ranked { entry: IndexEntry; score: number }
/** Ranks nodes against a query by best score over the node name and all aliases. */
export function rankNodes(query: string, index: IndexEntry[], opts: { minScore?: number; minPrefix?: number; limit?: number } = {}): Ranked[] {
  const q = normalize(query);
  if (!q) return [];
  const { minScore = 50, minPrefix = 2, limit = 50 } = opts;
  const out: Ranked[] = [];
  for (const entry of index) {
    let best = 0;
    for (const k of entry.keys) best = Math.max(best, scoreMatch(q, k, minPrefix));
    if (best >= minScore) out.push({ entry, score: best });
  }
  // Higher score first; on ties prefer the shallower node, then tree order (stable sort).
  out.sort((a, b) => b.score - a.score || a.entry.path.length - b.entry.path.length);
  return out.slice(0, limit);
}

export function suggest(query: string, tree: SubjectNode[], limit = 8): Ranked[] {
  return rankNodes(query, buildIndex(tree), { minScore: 50, minPrefix: 1, limit });
}

/** Names of the direct children at `prefix` ([] = categories). */
export function childNames(tree: SubjectNode[], prefix: string[]): string[] {
  if (!prefix.length) return tree.map((n) => n.name);
  return findNode(tree, prefix)?.children.map((n) => n.name) ?? [];
}

import { normalizePath, type DataAdapter, type Vault } from "obsidian";
import type { StorageIO } from "./core/store";
import type { TrackerPaths } from "./host";

export class ObsidianIO implements StorageIO {
  constructor(private a: DataAdapter) {}
  exists(p: string) { return this.a.exists(normalizePath(p)); }
  read(p: string) { return this.a.read(normalizePath(p)); }
  write(p: string, d: string) { return this.a.write(normalizePath(p), d); }
  append(p: string, d: string) { return this.a.append(normalizePath(p), d); }
  remove(p: string) { return this.a.remove(normalizePath(p)); }
  async mkdir(dir: string) { await ensureFolder(this.a, dir); }
  async list(dir: string) { const d = normalizePath(dir); return (await this.a.exists(d)) ? (await this.a.list(d)).files : []; }
}

export async function ensureFolder(a: DataAdapter, path: string): Promise<void> {
  let acc = "";
  for (const seg of normalizePath(path).split("/").filter(Boolean)) {
    acc = acc ? `${acc}/${seg}` : seg;
    if (!(await a.exists(acc))) await a.mkdir(acc);
  }
}

export function pathsFor(root: string): TrackerPaths {
  const r = normalizePath(root || "Tracking");
  return { root: r, database: `${r}/Database`, subjects: `${r}/Subjects`, templates: `${r}/Templates`, dashboard: `${r}/Dashboard`, reports: `${r}/Reports`, backups: `${r}/Backups` };
}

/** Creates the folder structure and two small notes. Never overwrites an existing file. */
export async function createStructure(vault: Vault, root: string): Promise<TrackerPaths> {
  const p = pathsFor(root);
  for (const dir of [p.database, p.subjects, p.templates, p.dashboard, p.reports, p.backups]) await ensureFolder(vault.adapter, dir);
  const files: Record<string, string> = {
    [`${p.dashboard}/My Tracker Dashboard.md`]:
      "# My Tracker\n\nOpen the full dashboard from the ribbon icon or the command palette: **My Tracker: Open dashboard**.\n\nLive summaries can be embedded in any note with a `my-tracker` code block:\n\n```my-tracker\nsubject: Mathematics\nrange: last 14 days\ncompare: true\nchart: true\n```\n",
    [`${p.templates}/Embed examples.md`]:
      "Supported keys inside a `my-tracker` code block:\n\n- `subject:` any subject, alias or path (`Mathematics > Algebra`). Empty = everything.\n- `range:` e.g. `today`, `last 14 days`, `this week`, `previous month`, `this year`, `since january 1`.\n- `compare: true` adds the comparison with the previous period.\n- `metrics:` comma-separated ids, e.g. `total, sessions, consistency`.\n- `chart: true` adds a daily chart.\n",
  };
  for (const [path, body] of Object.entries(files)) if (!(await vault.adapter.exists(path))) await vault.adapter.write(path, body);
  return p;
}

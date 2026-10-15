import { closeSync, lstatSync, openSync, readdirSync, readSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

import git, { failure } from '../run';
import type { OperationResult } from '../status';

/** One path git ignores — a whole directory, or a single file. Root-relative, no trailing `/`. */
export interface IgnoredEntry {
  path: string;
  isDir: boolean;
}

/**
 * A row of the ignored-files tree.
 *
 * Two kinds: an *ignored* node is an entry git reported and is what actually gets removed; a
 * container is only the folder path down to ignored entries, and is never removed itself —
 * ticking one ticks the ignored entries under it.
 */
export interface IgnoredNode {
  /** Root-relative path, the node's identity. */
  path: string;
  /** What the row shows: the last segment, or a run of folders that hold nothing else. */
  name: string;
  isDir: boolean;
  ignored: boolean;
  /** Bytes on disk; a container sums its children. Undefined until measured. */
  size?: number;
  /** A file that often holds credentials or local config rather than something regenerable. */
  sensitive: boolean;
  children: IgnoredNode[];
}

/**
 * `git status --porcelain -z --ignored=matching --untracked-files=normal` into entries.
 *
 * That pairing is the one that answers "what can go": a directory comes back collapsed (`dist/`)
 * only when the directory itself matches a pattern, and never when it holds a tracked or a
 * plain-untracked file — those are listed path by path instead. `ls-files --others --ignored
 * --directory` looks equivalent but also names untracked folders that merely *contain* ignored
 * files, and removing one of those would take the untracked work beside them.
 */
export const parseIgnored = (raw: string): IgnoredEntry[] => {
  const entries: IgnoredEntry[] = [];
  const parts = raw.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? '';
    const code = entry.slice(0, 2);
    //? A rename carries its source as the next field; skip it so it is not read as an entry
    if (code[0] === 'R' || code[0] === 'C') i++;
    if (code !== '!!') continue;
    const path = entry.slice(3);
    const isDir = path.endsWith('/');
    entries.push({ path: isDir ? path.slice(0, -1) : path, isDir });
  }
  return entries;
};

export const getIgnored = async (root: string): Promise<IgnoredEntry[]> => {
  const result = await git(
    ['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=normal'],
    root,
  );
  return result.ok ? parseIgnored(result.stdout) : [];
};

/**
 * How a caller narrows the tree, as globs over root-relative paths (`**\/node_modules`,
 * `apps/legacy`). A pattern matching a folder covers everything under it.
 *
 * The seam for a project config or a wrapping tool to pass its own cleanup rules: nothing reads
 * a config file into this yet.
 */
export interface IgnoredOptions {
  /** Left out of the tree entirely, so they cannot be ticked. */
  hide?: string[];
  /** Ticked when the tree opens. Never deleted without the user's Enter. */
  preselect?: string[];
}

const matcher = (patterns: string[] = []) => {
  const globs = patterns.map((pattern) => new Bun.Glob(pattern.replace(/\/+$/, '')));
  return (path: string) => {
    if (!globs.length) return false;
    const segments = path.split('/');
    //? The path or any folder above it: hiding `apps/legacy` hides its node_modules too
    for (let at = 1; at <= segments.length; at++) {
      const prefix = segments.slice(0, at).join('/');
      if (globs.some((glob) => glob.match(prefix))) return true;
    }
    return false;
  };
};

/** Drop hidden entries, and name the ones to start ticked. */
export const applyIgnoredOptions = (
  entries: IgnoredEntry[],
  options: IgnoredOptions = {},
): { entries: IgnoredEntry[]; preselected: string[] } => {
  const hidden = matcher(options.hide);
  const picked = matcher(options.preselect);
  const kept = entries.filter((entry) => !hidden(entry.path));
  return { entries: kept, preselected: kept.filter((e) => picked(e.path)).map((e) => e.path) };
};

/** What the preview pane shows for one tree row. */
export interface IgnoredPreview {
  /** One line on what it is — "text · 12 lines", "folder · 40 entries". */
  summary: string;
  lines: string[];
}

/** How much of a file the preview reads: enough to fill any pane, never a whole log. */
const PREVIEW_BYTES = 64 * 1024;
const PREVIEW_ENTRIES = 500;

/** `KEY=value` with the value hidden — a preview is not where a secret should land on screen. */
const maskSecrets = (line: string) =>
  line.replace(/^(\s*(?:export\s+)?[\w.-]+\s*[=:]\s*)(.+)$/, (_all, key: string, value: string) =>
    value.trim() ? `${key}${'•'.repeat(Math.min(12, value.length))}` : `${key}${value}`,
  );

/**
 * A look at one row before deciding to delete it: the start of a file, what an ignored folder
 * holds at its top level, or for a container the ignored paths a tick would take.
 *
 * Reads at most `PREVIEW_BYTES` and lists at most `PREVIEW_ENTRIES`, so a 2 GB log or a
 * node_modules costs the same as a small one. Values in files flagged as sensitive are masked.
 */
export const previewIgnored = (root: string, node: IgnoredNode): IgnoredPreview => {
  if (!node.ignored) {
    const paths = ignoredPaths(node);
    return {
      summary: `${paths.length} ignored path${paths.length === 1 ? '' : 's'} inside`,
      lines: paths.map((path) => path.slice(node.path.length + 1)),
    };
  }
  const target = join(root, node.path);
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) return { summary: 'symlink', lines: [] };
    if (stat.isDirectory()) {
      const dirents = readdirSync(target, { withFileTypes: true });
      const lines = dirents
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, PREVIEW_ENTRIES)
        .map((d) => `${d.name}${d.isDirectory() ? '/' : ''}`);
      if (dirents.length > PREVIEW_ENTRIES) lines.push(`… ${dirents.length - PREVIEW_ENTRIES} more`);
      return { summary: `folder · ${dirents.length} entries`, lines };
    }
    const buffer = Buffer.alloc(Math.min(PREVIEW_BYTES, stat.size));
    const fd = openSync(target, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, 0);
    } finally {
      closeSync(fd);
    }
    if (buffer.subarray(0, 8192).includes(0)) return { summary: 'binary file', lines: [] };
    let lines = buffer.toString('utf-8').replace(/\t/g, '  ').split(/\r?\n/);
    if (stat.size > PREVIEW_BYTES) lines = [...lines.slice(0, -1), '… (truncated)'];
    else if (lines.at(-1) === '') lines.pop();
    if (node.sensitive) lines = lines.map(maskSecrets);
    return {
      summary: lines.length
        ? `text · ${lines.length} lines${node.sensitive ? ' · values masked' : ''}`
        : 'empty file',
      lines,
    };
  } catch (error) {
    return { summary: `cannot read: ${(error as Error).message}`, lines: [] };
  }
};

/** How many paths go to one `du`, so a repository with thousands of ignored files stays under ARG_MAX. */
const DU_BATCH = 400;

/**
 * Bytes each path takes on disk, by root-relative path.
 *
 * `du` rather than a walk in JS: an ignored `node_modules` is hundreds of thousands of files, and
 * `du` gets through it several times faster. It does not follow symlinks, so a linked directory
 * counts as the link and not as whatever it points at. A path `du` cannot read is left out.
 */
export const measureIgnored = async (
  root: string,
  paths: string[],
): Promise<Map<string, number>> => {
  const sizes = new Map<string, number>();
  const batches: string[][] = [];
  for (let at = 0; at < paths.length; at += DU_BATCH) batches.push(paths.slice(at, at + DU_BATCH));
  await Promise.all(
    batches.map(async (batch) => {
      try {
        const child = Bun.spawn(['du', '-sk', '--', ...batch], {
          cwd: root,
          stdout: 'pipe',
          stderr: 'ignore',
        });
        const out = await new Response(child.stdout).text();
        await child.exited;
        for (const line of out.split('\n')) {
          const tab = line.indexOf('\t');
          if (tab < 0) continue;
          const kb = Number.parseInt(line.slice(0, tab), 10);
          if (Number.isFinite(kb)) sizes.set(line.slice(tab + 1), kb * 1024);
        }
      } catch {
        //? No `du` on this system: the tree still works, just without sizes
      }
    }),
  );
  return sizes;
};

const SENSITIVE = [/^\.env($|\.)/, /\.(pem|key|p12|pfx)$/, /^\.npmrc$/, /^\.netrc$/];

const isSensitive = (name: string) => SENSITIVE.some((pattern) => pattern.test(name));

const bySizeThenName = (a: IgnoredNode, b: IgnoredNode) =>
  (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name);

/**
 * Fold ignored entries into a tree of the folders that lead to them.
 *
 * Largest first at every level — the point of the list is finding what is worth deleting. A
 * folder holding nothing but one other folder is shown as one row (`apps/web`), so a deep
 * monorepo does not cost a row per level on the way to its one `node_modules`.
 */
export const buildIgnoredTree = (
  entries: IgnoredEntry[],
  sizes?: Map<string, number>,
): IgnoredNode[] => {
  const top: IgnoredNode = {
    path: '',
    name: '',
    isDir: true,
    ignored: false,
    sensitive: false,
    children: [],
  };
  for (const entry of entries) {
    const segments = entry.path.split('/');
    let parent = top;
    for (const [at, segment] of segments.entries()) {
      const path = segments.slice(0, at + 1).join('/');
      const last = at === segments.length - 1;
      let node = parent.children.find((child) => child.path === path);
      if (!node) {
        node = {
          path,
          name: segment,
          isDir: last ? entry.isDir : true,
          ignored: last,
          sensitive: last && !entry.isDir && isSensitive(segment),
          children: [],
        };
        parent.children.push(node);
      }
      parent = node;
    }
  }

  const finish = (node: IgnoredNode): IgnoredNode => {
    if (node.ignored) return { ...node, size: sizes?.get(node.path) };
    let children = node.children.map(finish);
    let { name } = node;
    //? Collapse a folder whose only content is another folder on the way down
    while (children.length === 1 && children[0] && !children[0].ignored) {
      const only: IgnoredNode = children[0];
      name = `${name}/${only.name}`;
      children = only.children;
      node = { ...node, path: only.path };
    }
    const measured = children.every((child) => child.size !== undefined);
    const size = measured ? children.reduce((sum, child) => sum + (child.size ?? 0), 0) : undefined;
    return { ...node, name, size, children: children.sort(bySizeThenName) };
  };

  return top.children.map(finish).sort(bySizeThenName);
};

/** Every ignored path at or below `node` — what ticking it would remove. */
export const ignoredPaths = (node: IgnoredNode): string[] =>
  node.ignored ? [node.path] : node.children.flatMap(ignoredPaths);

/** Bytes, the way a cleanup list wants them: one decimal past KB, no decimals below it. */
export const formatSize = (bytes: number | undefined): string => {
  if (bytes === undefined) return '…';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

/** Plain-text tree, for `giti clear --list` and for output that is not a terminal. */
export const printIgnoredTree = (nodes: IgnoredNode[]): string[] => {
  const lines: string[] = [];
  const walk = (list: IgnoredNode[], prefix: string) => {
    for (const [at, node] of list.entries()) {
      const last = at === list.length - 1;
      const label = `${node.name}${node.isDir ? '/' : ''}`;
      const notes = [formatSize(node.size), ...(node.sensitive ? ['may hold secrets'] : [])];
      lines.push(`${prefix}${last ? '└─ ' : '├─ '}${label}  (${notes.join(', ')})`);
      if (!node.ignored) walk(node.children, `${prefix}${last ? '   ' : '│  '}`);
    }
  };
  walk(nodes, '');
  return lines;
};

export interface ClearIgnoredResult extends OperationResult {
  removed: string[];
  failed: { path: string; error: string }[];
}

/**
 * Delete ignored paths — whole, recursively, with no copy kept.
 *
 * Asks git again rather than trusting the list it is handed: a path is removed only if git still
 * reports it, or a directory above it, as ignored right now. A file someone has started tracking
 * since the list was drawn, or a path from anywhere else, is refused rather than deleted.
 */
export const clearIgnored = async (
  root: string,
  paths: string[],
): Promise<ClearIgnoredResult> => {
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];
  if (!paths.length) return { ok: false, message: 'Nothing selected', removed, failed };

  const status = await git(
    ['status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=normal'],
    root,
  );
  if (!status.ok) {
    return { ok: false, message: failure(status, 'git status failed'), removed, failed };
  }
  const current = parseIgnored(status.stdout);
  const stillIgnored = (path: string) =>
    current.some(
      (entry) => entry.path === path || (entry.isDir && path.startsWith(`${entry.path}/`)),
    );

  for (const path of paths) {
    const target = join(root, path);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('.git')) {
      failed.push({ path, error: 'outside the work tree' });
      continue;
    }
    if (!stillIgnored(path)) {
      failed.push({ path, error: 'no longer ignored' });
      continue;
    }
    try {
      rmSync(target, { recursive: true, force: true });
      removed.push(path);
    } catch (error) {
      failed.push({ path, error: (error as Error).message });
    }
  }

  const what = removed.length === 1 ? removed[0] : `${removed.length} ignored paths`;
  const message = failed.length
    ? `Removed ${removed.length}, failed ${failed.length}: ${failed
        .map((f) => `${f.path} (${f.error})`)
        .join(', ')}`
    : `Removed ${what}`;
  return { ok: failed.length === 0, message, removed, failed };
};

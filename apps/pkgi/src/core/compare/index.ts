import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { type Dependency, type Manifest, readManifest } from '../manifest';
import { cleanVersion, compareVersions } from '../semver';

export interface CompareColumn {
  /** Absolute path. */
  dir: string;
  /** How it is shown: `.` for the current folder, else the path relative to it. */
  label: string;
  manifest: Manifest;
}

export interface CompareRow {
  name: string;
  /** One per column, in column order; undefined where the folder does not declare it. */
  cells: (Dependency | undefined)[];
  /** The folders disagree: different versions, or declared in some and not others. */
  differs: boolean;
  /** The newest version any folder has — what "align" moves the others to. */
  highest?: string;
}

/** `../web` relative to `from`, `.` for `from` itself — how folders are written in settings. */
export const toRelative = (from: string, dir: string): string => relative(from, dir) || '.';

export const toAbsolute = (from: string, path: string): string =>
  isAbsolute(path) ? path : resolve(from, path);

const versionOf = (dep: Dependency | undefined) =>
  dep ? (dep.installed ?? cleanVersion(dep.range)) : undefined;

export const loadColumns = async (from: string, dirs: string[]): Promise<CompareColumn[]> =>
  Promise.all(
    dirs.map(async (dir) => ({
      dir,
      label: toRelative(from, dir),
      manifest: await readManifest(dir),
    })),
  );

/**
 * The union of every folder's dependencies, one row per package, with a cell per folder.
 *
 * Versions are compared as installed where they are installed and as declared where not: two
 * folders both saying `^18.2.0` can have 18.2.0 and 18.3.1 in their `node_modules`, and that is
 * exactly the difference a comparison is for.
 */
export const buildComparison = (columns: CompareColumn[]): CompareRow[] => {
  const names = new Set<string>();
  for (const column of columns) for (const dep of column.manifest.dependencies) names.add(dep.name);
  return [...names].sort().map((name) => {
    const cells = columns.map((column) =>
      column.manifest.dependencies.find((dep) => dep.name === name),
    );
    const versions = cells.map(versionOf);
    const present = versions.filter((version): version is string => Boolean(version));
    const differs = present.length !== cells.length || new Set(present).size > 1;
    const highest = present.sort(compareVersions).at(-1);
    return { name, cells, differs, highest };
  });
};

export const cellVersion = versionOf;

const hasManifest = (dir: string) => existsSync(join(dir, 'package.json'));

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `apps/*` → every folder in `apps` with a `package.json`. Only the one-star form workspaces use. */
const expandWorkspace = (root: string, pattern: string): string[] => {
  const clean = pattern.replace(/\/+$/, '').replace(/^\.\//, '');
  if (!clean.endsWith('/*') && !clean.endsWith('/**')) {
    const dir = join(root, clean);
    return hasManifest(dir) ? [dir] : [];
  }
  const parent = join(root, clean.replace(/\/\*\*?$/, ''));
  try {
    return readdirSync(parent)
      .map((entry) => join(parent, entry))
      .filter((dir) => isDirectory(dir) && hasManifest(dir));
  } catch {
    return [];
  }
};

/** The workspace root above (or at) `dir` and its members, when `dir` is inside a workspace. */
const workspaceMembers = (dir: string): string[] => {
  let at = dir;
  while (true) {
    const file = join(at, 'package.json');
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
          workspaces?: string[] | { packages?: string[] };
        };
        const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
        if (patterns?.length) {
          return [at, ...patterns.flatMap((pattern) => expandWorkspace(at, pattern))];
        }
      } catch {}
    }
    const parent = dirname(at);
    if (parent === at) return [];
    at = parent;
  }
};

/**
 * Folders worth offering for comparison without anyone typing a path: the members of the
 * workspace `dir` is in (and its root), and the sibling folders next to it that have a
 * `package.json` — the `~/dev/*` layout, where related projects sit side by side.
 */
export const discoverFolders = (dir: string): string[] => {
  const found = new Set<string>(workspaceMembers(dir));
  const parent = dirname(dir);
  try {
    for (const entry of readdirSync(parent)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const sibling = join(parent, entry);
      if (isDirectory(sibling) && hasManifest(sibling)) found.add(sibling);
    }
  } catch {}
  found.delete(dir);
  return [...found].sort((a, b) => basename(a).localeCompare(basename(b)));
};

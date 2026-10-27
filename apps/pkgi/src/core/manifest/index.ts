import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { DependencyType, PackageManagerName } from '../../config/settings';
import { isLocalSpec, rangePrefix } from '../semver';

export interface Dependency {
  name: string;
  /** The range as `package.json` declares it — `^19.1.0`, `workspace:*`, a git URL. */
  range: string;
  type: DependencyType;
  /** The version actually in `node_modules`, or undefined when it is not installed. */
  installed?: string;
  /** Declared somewhere other than the registry (`workspace:`, `file:`, git) — nothing to update. */
  local: boolean;
  /** An override that decides the installed version whatever the range says — see `Override`. */
  override?: Override;
}

/** The fields that force a version on every copy of a package: npm and Bun, Yarn, pnpm. */
export type OverrideField = 'overrides' | 'resolutions' | 'pnpm.overrides';

/**
 * A version forced by `overrides` (or `resolutions`, `pnpm.overrides`) — in this folder's
 * `package.json` or its workspace root's. Only a plain entry for the package's own name counts;
 * nested and selector forms (`a>b`, `a@1`, objects) are left alone.
 */
export interface Override {
  /** The `package.json` it is in. */
  file: string;
  field: OverrideField;
  value: string;
}

export interface Manifest {
  dir: string;
  /** False when the folder has no `package.json` at all. */
  exists: boolean;
  name?: string;
  version?: string;
  dependencies: Dependency[];
  /** Why `package.json` could not be read, when it exists but is broken. */
  error?: string;
}

const TYPE_ORDER: DependencyType[] = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * The version installed for `name`, looked up the way Node resolves it: `node_modules/<name>` in
 * this folder, then in each parent — a workspace member's packages are usually hoisted to the
 * root, and Bun's isolated linker leaves a symlink in the member that this follows.
 */
export const installedVersion = async (dir: string, name: string): Promise<string | undefined> => {
  let at = dir;
  while (true) {
    const file = Bun.file(join(at, 'node_modules', name, 'package.json'));
    if (await file.exists()) {
      try {
        const version = ((await file.json()) as { version?: unknown }).version;
        return typeof version === 'string' ? version : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
  }
};

const OVERRIDE_PATHS: Record<OverrideField, string[]> = {
  overrides: ['overrides'],
  resolutions: ['resolutions'],
  'pnpm.overrides': ['pnpm', 'overrides'],
};

/** The plain overrides a parsed `package.json` declares, by package name. */
export const readOverrides = (pkg: Record<string, unknown>, file: string) => {
  const found: Record<string, Override> = {};
  for (const [field, path] of Object.entries(OVERRIDE_PATHS) as [OverrideField, string[]][]) {
    let section: unknown = pkg;
    for (const key of path)
      section = section && typeof section === 'object' ? (section as Record<string, unknown>)[key] : undefined;
    if (!section || typeof section !== 'object') continue;
    for (const [name, value] of Object.entries(section as Record<string, unknown>))
      if (typeof value === 'string' && !(name in found)) found[name] = { file, field, value };
  }
  return found;
};

/**
 * Overrides that reach this folder: its own `package.json`'s, then its workspace root's (the
 * nearest parent with `workspaces`), which a package manager applies to every member.
 */
const overridesFor = async (dir: string, pkg: Record<string, unknown>) => {
  const own = readOverrides(pkg, join(dir, 'package.json'));
  let at = dirname(dir);
  while (true) {
    const file = join(at, 'package.json');
    if (existsSync(file)) {
      try {
        const parent = (await Bun.file(file).json()) as Record<string, unknown>;
        if (parent.workspaces) return { ...readOverrides(parent, file), ...own };
      } catch {}
    }
    const up = dirname(at);
    if (up === at) return own;
    at = up;
  }
};

/** Index just past the JSON string whose opening quote is at `at`. */
const skipString = (text: string, at: number) => {
  let index = at + 1;
  while (index < text.length) {
    if (text[index] === '\\') index += 2;
    else if (text[index] === '"') return index + 1;
    else index += 1;
  }
  return index;
};

/** The keys of the JSON object opening at `open`, with where each value starts — its own only. */
const objectKeys = (text: string, open: number) => {
  const keys: { key: string; valueAt: number }[] = [];
  let depth = 0;
  let expectKey = false;
  let index = open;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end = skipString(text, index);
      if (depth === 1 && expectKey) {
        let value = text.indexOf(':', end) + 1;
        while (/\s/.test(text[value] ?? '')) value += 1;
        keys.push({ key: JSON.parse(text.slice(index, end)) as string, valueAt: value });
        expectKey = false;
        index = value;
        continue;
      }
      index = end;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
      if (depth === 1) expectKey = true;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) break;
    } else if (char === ',' && depth === 1) expectKey = true;
    index += 1;
  }
  return keys;
};

/**
 * `text` with the string at `path` replaced by `value` — the one value, so the file keeps its own
 * formatting and key order. Undefined when the path does not lead to a string.
 */
export const replaceJsonString = (
  text: string,
  path: string[],
  value: string,
): string | undefined => {
  let at = text.indexOf('{');
  for (const [step, key] of path.entries()) {
    if (at < 0 || text[at] !== '{') return undefined;
    const found = objectKeys(text, at).find((entry) => entry.key === key);
    if (!found) return undefined;
    at = found.valueAt;
    if (step === path.length - 1) {
      if (text[at] !== '"') return undefined;
      return text.slice(0, at) + JSON.stringify(value) + text.slice(skipString(text, at));
    }
  }
  return undefined;
};

/**
 * The override `version` should be written as, keeping the old one's `^`/`~`/exact form —
 * undefined for one that is not a plain version (a git URL, `$foo`, `>=1`), which is left alone.
 */
export const overrideValue = (override: Override, version: string): string | undefined => {
  const prefix = rangePrefix(override.value);
  return prefix === undefined ? undefined : `${prefix}${version}`;
};

/** Move `name`'s override to `version`. False when it could not be: see `overrideValue`. */
export const writeOverride = async (
  name: string,
  override: Override,
  version: string,
): Promise<boolean> => {
  const value = overrideValue(override, version);
  if (value === undefined) return false;
  const text = await Bun.file(override.file).text();
  const next = replaceJsonString(text, [...OVERRIDE_PATHS[override.field], name], value);
  if (next === undefined) return false;
  if (next !== text) await Bun.write(override.file, next);
  return true;
};

/** Read a folder's `package.json` and what is installed for each dependency it declares. */
export const readManifest = async (
  dir: string,
  types: readonly DependencyType[] = TYPE_ORDER,
): Promise<Manifest> => {
  const file = Bun.file(join(dir, 'package.json'));
  if (!(await file.exists())) return { dir, exists: false, dependencies: [] };
  let pkg: Record<string, unknown>;
  try {
    pkg = (await file.json()) as Record<string, unknown>;
  } catch (error) {
    return {
      dir,
      exists: true,
      dependencies: [],
      error: `package.json: ${(error as Error).message}`,
    };
  }
  const declared: Omit<Dependency, 'installed'>[] = [];
  for (const type of TYPE_ORDER) {
    if (!types.includes(type)) continue;
    const section = pkg[type];
    if (!section || typeof section !== 'object') continue;
    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (typeof range !== 'string') continue;
      declared.push({ name, range, type, local: isLocalSpec(range) });
    }
  }
  const overrides = await overridesFor(dir, pkg);
  const dependencies = await Promise.all(
    declared.map(async (dep) => ({
      ...dep,
      installed: await installedVersion(dir, dep.name),
      ...(overrides[dep.name] ? { override: overrides[dep.name] } : {}),
    })),
  );
  return {
    dir,
    exists: true,
    name: typeof pkg.name === 'string' ? pkg.name : undefined,
    version: typeof pkg.version === 'string' ? pkg.version : undefined,
    dependencies,
  };
};

/** Each manager's lockfiles, the one it writes today first. */
export const LOCKFILE_NAMES: Record<PackageManagerName, string[]> = {
  bun: ['bun.lock', 'bun.lockb'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  npm: ['package-lock.json', 'npm-shrinkwrap.json'],
};

const LOCKFILES = Object.entries(LOCKFILE_NAMES).flatMap(([name, files]) =>
  files.map((file) => [file, name as PackageManagerName] as const),
);

/** The lockfile `manager` keeps in `dir` itself, if it has written one there yet. */
export const findLockfile = (dir: string, manager: PackageManagerName): string | undefined =>
  LOCKFILE_NAMES[manager].map((file) => join(dir, file)).find((path) => existsSync(path));

export interface DetectedManager {
  name: PackageManagerName;
  /** How it was decided — shown in the Settings tab so the choice is never a mystery. */
  reason: string;
  /** The exact version `packageManager` pins (`bun@1.4.2` → `1.4.2`), when that decided it. */
  version?: string;
  /** The folder the decision was read from — a workspace member's is its root. */
  root?: string;
}

/** `bun@1.4.2`, `pnpm@9.1.0+sha512.…` → name and version, or undefined for anything else. */
export const parsePackageManagerField = (
  field: unknown,
): { name: PackageManagerName; version?: string } | undefined => {
  if (typeof field !== 'string') return undefined;
  const [name, version] = field.split('+')[0]?.split('@') ?? [];
  if (!name || !(name in LOCKFILE_NAMES)) return undefined;
  return { name: name as PackageManagerName, version: version || undefined };
};

const readPackageManagerField = async (dir: string) => {
  try {
    const pkg = (await Bun.file(join(dir, 'package.json')).json()) as { packageManager?: unknown };
    const parsed = parsePackageManagerField(pkg.packageManager);
    return parsed && { ...parsed, field: pkg.packageManager as string };
  } catch {
    return undefined;
  }
};

/**
 * Which package manager this folder uses: the setting if there is one, else the nearest folder
 * (this one, then each parent — a workspace member's is the root) that says so, where
 * `package.json`'s `packageManager` field outranks a lockfile beside it, else npm.
 */
export const detectPackageManager = async (
  dir: string,
  forced?: PackageManagerName,
): Promise<DetectedManager> => {
  if (forced) return { name: forced, reason: 'set in pkgi settings' };
  let at = dir;
  while (true) {
    const where = at === dir ? '' : ` in ${at}`;
    const declared = await readPackageManagerField(at);
    if (declared) {
      return {
        name: declared.name,
        version: declared.version,
        root: at,
        reason: `packageManager field (${declared.field})${where}`,
      };
    }
    for (const [file, name] of LOCKFILES) {
      if (existsSync(join(at, file))) return { name, root: at, reason: `${file}${where}` };
    }
    const parent = dirname(at);
    if (parent === at) break;
    at = parent;
  }
  return { name: 'npm', reason: 'no lockfile found — npm by default' };
};

/** The flag each manager uses to put a package in a given section. */
const SECTION_FLAGS: Record<PackageManagerName, Partial<Record<DependencyType, string>>> = {
  bun: { devDependencies: '--dev', peerDependencies: '--peer', optionalDependencies: '--optional' },
  npm: {
    devDependencies: '--save-dev',
    peerDependencies: '--save-peer',
    optionalDependencies: '--save-optional',
  },
  yarn: {
    devDependencies: '--dev',
    peerDependencies: '--peer',
    optionalDependencies: '--optional',
  },
  pnpm: {
    devDependencies: '--save-dev',
    peerDependencies: '--save-peer',
    optionalDependencies: '--save-optional',
  },
};

const EXACT_FLAG: Record<PackageManagerName, string> = {
  bun: '--exact',
  npm: '--save-exact',
  yarn: '--exact',
  pnpm: '--save-exact',
};

const ADD: Record<PackageManagerName, string[]> = {
  bun: ['bun', 'add'],
  npm: ['npm', 'install'],
  yarn: ['yarn', 'add'],
  pnpm: ['pnpm', 'add'],
};

const REMOVE: Record<PackageManagerName, string[]> = {
  bun: ['bun', 'remove'],
  npm: ['npm', 'uninstall'],
  yarn: ['yarn', 'remove'],
  pnpm: ['pnpm', 'remove'],
};

/**
 * The command that sets `name` to `version` in its current section, written the way the old range
 * was: `^1.2.0` → `^1.3.0`, an exact pin stays exact. Without the section flag, most managers
 * would move a dev dependency into `dependencies` on update.
 */
export const setVersionCommand = (
  manager: PackageManagerName,
  name: string,
  version: string,
  type: DependencyType,
  currentRange?: string,
): string[] => {
  const prefix = currentRange === undefined ? '^' : (rangePrefix(currentRange) ?? '^');
  const section = SECTION_FLAGS[manager][type];
  return [
    ...ADD[manager],
    `${name}@${prefix === '' ? version : `${prefix}${version}`}`,
    ...(section ? [section] : []),
    ...(prefix === '' ? [EXACT_FLAG[manager]] : []),
  ];
};

/** Add a package that is not declared yet, at a version or at `latest`. */
export const addCommand = (
  manager: PackageManagerName,
  name: string,
  version: string | undefined,
  type: DependencyType,
): string[] => {
  const section = SECTION_FLAGS[manager][type];
  return [...ADD[manager], version ? `${name}@${version}` : name, ...(section ? [section] : [])];
};

export const removeCommand = (manager: PackageManagerName, names: string[]): string[] => [
  ...REMOVE[manager],
  ...names,
];

/**
 * Run a `package.json` script. npm alone needs `--` before the script's own arguments, or it
 * takes flags like `--coverage` for itself.
 */
export const runScriptCommand = (
  manager: PackageManagerName,
  script: string,
  args: string[] = [],
): string[] =>
  manager === 'npm' && args.length
    ? ['npm', 'run', script, '--', ...args]
    : [manager, 'run', script, ...args];

/** Yarn Berry (2+) — by the pinned version, else by its `.yarnrc.yml`. */
const isYarnBerry = (version?: string, dir?: string) => {
  const major = version ? Number.parseInt(version, 10) : undefined;
  return major !== undefined ? major >= 2 : dir !== undefined && existsSync(join(dir, '.yarnrc.yml'));
};

/** The manager's security audit. Yarn Berry moved it under `yarn npm`. */
export const auditCommand = (
  manager: PackageManagerName,
  { version, dir }: { version?: string; dir?: string } = {},
): string[] =>
  manager === 'yarn' && isYarnBerry(version, dir) ? ['yarn', 'npm', 'audit'] : [manager, 'audit'];

/** Empty the manager's global download cache (pnpm's is a content store, pruned instead). */
export const clearCacheCommand = (manager: PackageManagerName): string[] => {
  switch (manager) {
    case 'bun':
      return ['bun', 'pm', 'cache', 'rm'];
    case 'npm':
      return ['npm', 'cache', 'clean', '--force'];
    case 'yarn':
      return ['yarn', 'cache', 'clean'];
    case 'pnpm':
      return ['pnpm', 'store', 'prune'];
  }
};

/**
 * Install everything the manifest declares. `frozen` installs exactly what the lockfile pins and
 * fails rather than rewrite it — the same versions anyone running the manager's plain install
 * gets from that lockfile. Yarn's flag depends on its generation: v1 has `--frozen-lockfile`,
 * Berry (2+, recognised by its version or its `.yarnrc.yml`) `--immutable`.
 */
export const installCommand = (
  manager: PackageManagerName,
  { frozen = false, version, dir }: { frozen?: boolean; version?: string; dir?: string } = {},
): string[] => {
  if (!frozen) return [manager, 'install'];
  switch (manager) {
    case 'npm':
      return ['npm', 'ci'];
    case 'yarn':
      return ['yarn', 'install', isYarnBerry(version, dir) ? '--immutable' : '--frozen-lockfile'];
    default:
      return [manager, 'install', '--frozen-lockfile'];
  }
};

/** Quote a command for display, and for `sh -c` when several run in a row. */
export const shellQuote = (argv: string[]): string =>
  argv
    .map((arg) => (/^[\w@%+=:,./^~-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`))
    .join(' ');

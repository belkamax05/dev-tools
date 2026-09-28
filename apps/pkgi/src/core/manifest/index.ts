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
  const dependencies = await Promise.all(
    declared.map(async (dep) => ({ ...dep, installed: await installedVersion(dir, dep.name) })),
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
    case 'yarn': {
      const major = version ? Number.parseInt(version, 10) : undefined;
      const berry =
        major !== undefined
          ? major >= 2
          : dir !== undefined && existsSync(join(dir, '.yarnrc.yml'));
      return ['yarn', 'install', berry ? '--immutable' : '--frozen-lockfile'];
    }
    default:
      return [manager, 'install', '--frozen-lockfile'];
  }
};

/** Quote a command for display, and for `sh -c` when several run in a row. */
export const shellQuote = (argv: string[]): string =>
  argv
    .map((arg) => (/^[\w@%+=:,./^~-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`))
    .join(' ');

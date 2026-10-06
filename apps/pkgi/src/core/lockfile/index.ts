import { basename, join } from 'node:path';

import type { PackageManagerName } from '../../config/settings';

/** One package archive a lockfile pins: where to download it and the hash it must have. */
export interface Tarball {
  name: string;
  version: string;
  url: string;
  /** Subresource-integrity string from the lockfile, e.g. `sha512-…`. */
  integrity: string;
  /** package.json's `os` / `cpu`, when the lockfile records them — see `forPlatform`. */
  os?: string[];
  cpu?: string[];
}

/** What a lockfile says must be installed, independent of which manager wrote it. */
export interface LockContents {
  /** Workspace folders relative to the root, the root itself as `''`. */
  workspaces: string[];
  tarballs: Tarball[];
  /** Entries no tarball + hash can stand for (git, local paths, archives without a hash). */
  unsupported: string[];
}

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** The registry's archive URL for a package: `@scope/name@1.0.0` → `…/@scope/name/-/name-1.0.0.tgz`. */
export const registryTarballUrl = (name: string, version: string, registry = DEFAULT_REGISTRY) =>
  `${registry.replace(/\/$/, '')}/${name}/-/${basename(name)}-${version}.tgz`;

/** A lockfile's `os` / `cpu` as a list — bun writes a single value as a plain string. */
const platformList = (value: unknown): string[] | undefined =>
  typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : undefined;

/** `os` / `cpu` from a lockfile entry, left out when it doesn't restrict them. */
const platformOf = (entry: unknown): Pick<Tarball, 'os' | 'cpu'> => {
  const { os, cpu } = (entry ?? {}) as { os?: unknown; cpu?: unknown };
  const out: Pick<Tarball, 'os' | 'cpu'> = {};
  const osList = platformList(os);
  const cpuList = platformList(cpu);
  if (osList?.length) out.os = osList;
  if (cpuList?.length) out.cpu = cpuList;
  return out;
};

/**
 * Whether `value` (this machine's `process.platform` / `process.arch`) passes a package's `os` /
 * `cpu` list, as npm and bun read it: `!x` excludes x, any plain entry makes it an allow-list, and
 * `none` — what bun writes for a platform it has no name for (netbsd, riscv64, wasm32) — allows
 * nothing.
 */
const allows = (list: string[] | undefined, value: string): boolean => {
  if (!list?.length || list.includes('any')) return true;
  if (list.includes(`!${value}`)) return false;
  const allowed = list.filter((entry) => !entry.startsWith('!'));
  return allowed.length === 0 || allowed.includes(value);
};

/**
 * The tarballs a manager would actually install on this platform: packages built for another
 * os/cpu (`@nx/nx-win32-x64-msvc` on Linux) are optional dependencies it skips, so fetching them
 * is wasted time.
 */
export const forPlatform = (
  tarballs: Tarball[],
  platform: string = process.platform,
  arch: string = process.arch,
): Tarball[] => tarballs.filter((t) => allows(t.os, platform) && allows(t.cpu, arch));

/** `name@version` → its two halves; a scoped name keeps its leading `@`. */
const splitIdent = (ident: string): [string, string] => {
  const at = ident.lastIndexOf('@');
  return at > 0 ? [ident.slice(0, at), ident.slice(at + 1)] : [ident, ''];
};

/** Collects tarballs, one per URL — the same archive often appears under several keys. */
const collector = () => {
  const byUrl = new Map<string, Tarball>();
  const unsupported: string[] = [];
  return {
    add: (tarball: Tarball) => {
      if (!byUrl.has(tarball.url)) byUrl.set(tarball.url, tarball);
    },
    skip: (what: string) => unsupported.push(what),
    done: (workspaces: string[]): LockContents => ({
      workspaces: [...new Set(workspaces)].sort(),
      tarballs: [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url)),
      unsupported,
    }),
  };
};

/**
 * `bun.lock` (text, JSONC). A registry package is `[ident, registry, info, integrity]` — registry
 * `""` means the default one, and for a package from any other registry (an `.npmrc` scope) bun
 * writes the archive's full URL there instead of the registry's; workspaces are listed under
 * `workspaces` by path.
 */
export const parseBunLock = (text: string): LockContents => {
  const lock = Bun.JSONC.parse(text) as {
    workspaces?: Record<string, unknown>;
    packages?: Record<string, unknown[]>;
  };
  const out = collector();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const ident = entry[0];
    if (typeof ident !== 'string') continue;
    const [name, version] = splitIdent(ident);
    if (version.startsWith('workspace:')) continue;
    const registry = entry[1];
    const integrity = entry[3];
    if (entry.length === 4 && typeof registry === 'string' && typeof integrity === 'string') {
      out.add({
        name,
        version,
        url: /\.tgz$/.test(registry)
          ? registry
          : registryTarballUrl(name, version, registry || DEFAULT_REGISTRY),
        integrity,
        ...platformOf(entry[2]),
      });
    } else {
      out.skip(`${key}: ${ident}`);
    }
  }
  return out.done(Object.keys(lock.workspaces ?? { '': {} }));
};

/**
 * `package-lock.json` / `npm-shrinkwrap.json`, lockfile v2 and v3: every installed package is under
 * `packages`, keyed by its `node_modules/…` path; keys without `node_modules` are workspaces.
 */
export const parseNpmLock = (text: string): LockContents => {
  const lock = JSON.parse(text) as {
    lockfileVersion?: number;
    packages?: Record<
      string,
      {
        name?: string;
        version?: string;
        resolved?: string;
        integrity?: string;
        link?: boolean;
        inBundle?: boolean;
        os?: string[];
        cpu?: string[];
      }
    >;
  };
  if (!lock.packages) {
    throw new Error(
      `package-lock.json v${lock.lockfileVersion ?? 1} has no "packages" — re-save it with npm 7+`,
    );
  }
  const out = collector();
  const workspaces = [''];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/')) {
      if (path !== '') workspaces.push(path);
      continue;
    }
    if (entry.link || entry.inBundle) continue;
    const name =
      entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const { version = '', resolved, integrity } = entry;
    if (resolved && integrity && /^https?:\/\//.test(resolved)) {
      out.add({ name, version, url: resolved, integrity, ...platformOf(entry) });
    } else {
      out.skip(`${path}: ${resolved ?? version}`);
    }
  }
  return out.done(workspaces);
};

/**
 * `pnpm-lock.yaml`, v6 (`/name@1.0.0` keys) and v9 (`name@1.0.0`): each package's `resolution`
 * carries its integrity, and `tarball` when it isn't the registry's; `importers` are workspaces.
 */
export const parsePnpmLock = (text: string): LockContents => {
  const lock = Bun.YAML.parse(text) as {
    importers?: Record<string, unknown>;
    packages?: Record<
      string,
      { resolution?: { integrity?: string; tarball?: string }; os?: string[]; cpu?: string[] }
    >;
  };
  const out = collector();
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const ident = key.replace(/^\//, '').replace(/\(.*$/, '');
    const [name, version] = splitIdent(ident);
    const { integrity, tarball } = entry.resolution ?? {};
    if (integrity && (!tarball || /^https?:\/\//.test(tarball))) {
      out.add({
        name,
        version,
        url: tarball ?? registryTarballUrl(name, version),
        integrity,
        ...platformOf(entry),
      });
    } else {
      out.skip(`${key}: ${tarball ?? 'no integrity'}`);
    }
  }
  const importers = Object.keys(lock.importers ?? { '.': {} }).map((dir) =>
    dir === '.' ? '' : dir,
  );
  return out.done(importers);
};

/**
 * Classic `yarn.lock` (v1): blocks of `"a@^1", a@^2:` followed by indented `version`, `resolved`
 * (URL, `#sha1` fragment dropped) and `integrity`. Workspaces aren't in it — the caller passes the
 * ones `package.json` declares. Yarn Berry's lockfile records checksums of its own zip archives,
 * not of the registry's tarballs, so nothing in it can be fetched and verified.
 */
export const parseYarnLock = (text: string, workspaces: string[] = ['']): LockContents => {
  if (/^__metadata:/m.test(text)) {
    throw new Error(
      "yarn.lock is Yarn Berry's (2+): its checksums are of Yarn's own zip archives, not of the registry tarballs, so it can't be installed through Nix",
    );
  }
  const out = collector();
  const blocks = text.split(/\n(?=\S)/);
  for (const block of blocks) {
    const [header, ...lines] = block.split('\n');
    if (!header || header.startsWith('#') || !header.endsWith(':')) continue;
    const field = (key: string) =>
      lines
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${key} `))
        ?.slice(key.length + 1)
        .replace(/^"|"$/g, '');
    const first = header.split(',')[0]?.trim().replace(/^"|"$/g, '') ?? header;
    const name = first.slice(0, first.lastIndexOf('@') > 0 ? first.lastIndexOf('@') : undefined);
    const version = field('version') ?? '';
    const resolved = field('resolved')?.replace(/#.*$/, '');
    const integrity = field('integrity');
    if (resolved && integrity && /^https?:\/\//.test(resolved)) {
      out.add({ name, version, url: resolved, integrity });
    } else {
      out.skip(`${first}: ${resolved ?? 'no resolved'}`);
    }
  }
  return out.done(workspaces);
};

/** The workspace folders `package.json`'s `workspaces` globs match (both the array and `{ packages }` forms). */
export const declaredWorkspaces = async (root: string): Promise<string[]> => {
  let patterns: string[] = [];
  try {
    const pkg = (await Bun.file(join(root, 'package.json')).json()) as {
      workspaces?: string[] | { packages?: string[] };
    };
    patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces?.packages ?? []);
  } catch {}
  const found = new Set<string>(['']);
  for (const pattern of patterns.filter((p) => !p.startsWith('!'))) {
    for await (const file of new Bun.Glob(`${pattern.replace(/\/$/, '')}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      if (!file.includes('node_modules/')) found.add(file.replace(/\/?package\.json$/, ''));
    }
  }
  for (const pattern of patterns.filter((p) => p.startsWith('!'))) {
    const glob = new Bun.Glob(pattern.slice(1).replace(/\/$/, ''));
    for (const dir of found) if (dir && glob.match(dir)) found.delete(dir);
  }
  return [...found];
};

/** Read the lockfile `manager` wrote at `path` into what must be installed. */
export const readLockfile = async (
  root: string,
  manager: PackageManagerName,
  path: string,
): Promise<LockContents> => {
  const text = await Bun.file(path).text();
  switch (manager) {
    case 'bun':
      if (path.endsWith('.lockb')) {
        throw new Error(
          'bun.lockb is binary — run `bun install --save-text-lockfile` for a bun.lock',
        );
      }
      return parseBunLock(text);
    case 'npm':
      return parseNpmLock(text);
    case 'pnpm':
      return parsePnpmLock(text);
    case 'yarn':
      return parseYarnLock(text, await declaredWorkspaces(root));
  }
};

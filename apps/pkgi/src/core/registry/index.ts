import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { PackageManagerName } from '../../config/settings';

import { pkgiCacheDir } from '../../config/paths';
import { compareVersions, isPrerelease } from '../semver';

/** What pkgi keeps about a package from the registry — enough for the list and the picker. */
export interface PackageInfo {
  name: string;
  latest?: string;
  /** The newest prerelease tagged ahead of `latest` (`next`, `beta`, `canary`, `rc`…). */
  next?: string;
  nextTag?: string;
  distTags: Record<string, string>;
  /** Every published version, oldest first. */
  versions: string[];
  /** Only the deprecated versions, with the author's message. */
  deprecated: Record<string, string>;
  /** When the package last changed on the registry — in practice, its last publish. */
  modified?: string;
  fetchedAt: number;
  /** `not-found` for a package the registry does not have (a private or local one). */
  error?: string;
}

export interface RegistryOptions {
  registry: string;
  /** Project directory for CLI registry/auth configuration and isolated fallback caching. */
  cwd?: string;
  packageManager?: PackageManagerName;
  /** Reuse a cached answer younger than this. */
  maxAgeMs: number;
  /** Ask the registry even when the cache is fresh. */
  force?: boolean;
}

const CACHE_FILE = () => join(pkgiCacheDir(), 'registry.json');

let cache: Record<string, PackageInfo> | undefined;
let dirty = false;

const loadCache = async (): Promise<Record<string, PackageInfo>> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(await Bun.file(CACHE_FILE()).text()) as Record<string, PackageInfo>;
  } catch {
    cache = {};
  }
  return cache;
};

/** Persist what was fetched since the last flush. Never throws: a cache that cannot be written only costs speed. */
export const flushRegistryCache = async (): Promise<void> => {
  if (!cache || !dirty) return;
  dirty = false;
  try {
    await mkdir(pkgiCacheDir(), { recursive: true });
    const temporary = `${CACHE_FILE()}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, CACHE_FILE());
  } catch {}
};

/** `@scope/name` must reach the registry as `@scope%2fname`; the `@` stays. */
const encodeName = (name: string) => name.replace('/', '%2f');

const cacheKey = (registry: string, name: string) => `${registry}|${name}`;

/**
 * Pick the prerelease worth offering: the newest dist-tag that is a prerelease and ahead of
 * `latest`. Tags are named by convention only (`next`, `beta`, `canary`, `rc`, `alpha`, `dev`…),
 * so all of them are considered rather than a fixed list.
 */
const pickNext = (tags: Record<string, string>, latest?: string) => {
  let best: { tag: string; version: string } | undefined;
  for (const [tag, version] of Object.entries(tags)) {
    if (tag === 'latest' || !isPrerelease(version)) continue;
    if (latest && compareVersions(version, latest) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { tag, version };
  }
  return best;
};

/**
 * One package's registry metadata, through the cache.
 *
 * Asks for the *abbreviated* document (`application/vnd.npm.install-v1+json`) — the one package
 * managers use. It has every version, the dist-tags and the deprecation messages, and none of the
 * READMEs: for a package like `typescript` that is a few hundred KB instead of tens of MB.
 */
const getHttpPackageInfo = async (
  name: string,
  { registry, maxAgeMs, force = false }: RegistryOptions,
): Promise<PackageInfo> => {
  const store = await loadCache();
  const key = cacheKey(registry, name);
  const cached = store[key];
  if (cached && !force && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

  try {
    const response = await fetch(`${registry}/${encodeName(name)}`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
    });
    if (!response.ok) {
      const info: PackageInfo = {
        name,
        distTags: {},
        versions: [],
        deprecated: {},
        fetchedAt: Date.now(),
        error: response.status === 404 ? 'not-found' : `registry answered ${response.status}`,
      };
      store[key] = info;
      dirty = true;
      return info;
    }
    const doc = (await response.json()) as {
      'dist-tags'?: Record<string, string>;
      versions?: Record<string, { deprecated?: string }>;
      modified?: string;
    };
    const distTags = doc['dist-tags'] ?? {};
    const versions = Object.keys(doc.versions ?? {}).sort(compareVersions);
    const deprecated: Record<string, string> = {};
    for (const [version, meta] of Object.entries(doc.versions ?? {})) {
      if (meta.deprecated) deprecated[version] = meta.deprecated;
    }
    const next = pickNext(distTags, distTags.latest);
    const info: PackageInfo = {
      name,
      latest: distTags.latest,
      next: next?.version,
      nextTag: next?.tag,
      distTags,
      versions,
      deprecated,
      ...(typeof doc.modified === 'string' ? { modified: doc.modified } : {}),
      fetchedAt: Date.now(),
    };
    store[key] = info;
    dirty = true;
    return info;
  } catch (error) {
    //? Offline: an old answer is far more useful than none
    if (cached) return cached;
    return {
      name,
      distTags: {},
      versions: [],
      deprecated: {},
      fetchedAt: 0,
      error: (error as Error).message,
    };
  }
};

/** Read-only metadata query; never invokes a shell, installs packages, or prints credentials. */
const runRegistryCommand = async (command: string[], cwd: string): Promise<unknown> => {
  const child = Bun.spawn(command, {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: 15000,
  });
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) return undefined;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
};

export const getCliPackageInfo = async (
  name: string,
  options: RegistryOptions,
  run = runRegistryCommand,
): Promise<PackageInfo | undefined> => {
  // Package names, never arbitrary package specs or command options.
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name.startsWith('-')) return;
  const tools = options.packageManager === 'bun' ? ['bun', 'npm'] : ['npm', 'bun'];
  for (const tool of tools) {
    const command = [tool, tool === 'bun' ? 'info' : 'view', name, 'dist-tags', '--json'];
    // Let project/user config choose the default registry; preserve an explicit pkgi override.
    if (options.registry.replace(/\/$/, '') !== 'https://registry.npmjs.org')
      command.push('--registry=' + options.registry);
    if (tool === 'npm') command.push('--fetch-retries=0', '--fetch-timeout=10000');
    if (options.force) command.push(tool === 'bun' ? '--no-cache' : '--prefer-online');
    try {
      const data = await run(command, options.cwd ?? process.cwd());
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      const distTags = Object.fromEntries(
        Object.entries(data).filter(
          ([, value]) =>
            typeof value === 'string' &&
            /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value),
        ),
      );
      if (!distTags.latest) continue;
      const next = pickNext(distTags, distTags.latest);
      return {
        name,
        latest: distTags.latest,
        next: next?.version,
        nextTag: next?.tag,
        distTags,
        versions: [...new Set(Object.values(distTags))].sort(compareVersions),
        deprecated: {},
        fetchedAt: Date.now(),
      };
    } catch {
      /* Missing CLI, timeout, or inaccessible registry: try the other tool. */
    }
  }
};

export const getPackageInfo = async (
  name: string,
  options: RegistryOptions,
): Promise<PackageInfo> => {
  const store = await loadCache();
  const key =
    'cli|' +
    cacheKey(options.registry, name) +
    '|' +
    resolve(options.cwd ?? process.cwd()) +
    '|' +
    (options.packageManager ?? 'npm');
  const cached = store[key];
  if (
    cached?.latest &&
    !cached.error &&
    !options.force &&
    Date.now() - cached.fetchedAt < options.maxAgeMs
  )
    return cached;
  const info = await getHttpPackageInfo(name, options);
  if (info.latest && !info.error) return info;
  const cli = await getCliPackageInfo(name, options);
  if (!cli) return cached?.latest && !cached.error ? cached : info;
  const result: PackageInfo = {
    ...info,
    ...cli,
    deprecated: info.deprecated,
    versions: [...new Set([...info.versions, ...cli.versions])].sort(compareVersions),
  };
  delete result.error;
  store[key] = result;
  dirty = true;
  return result;
};

/**
 * Many packages at once, `concurrency` requests in flight. Reports progress as each lands, and
 * writes the cache once at the end rather than after every package.
 */
export const getManyPackageInfo = async (
  names: string[],
  options: RegistryOptions,
  onProgress?: (done: number, total: number) => void,
  concurrency = 12,
): Promise<Record<string, PackageInfo>> => {
  const out: Record<string, PackageInfo> = {};
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      if (!name) continue;
      out[name] = await getPackageInfo(name, options);
      done += 1;
      onProgress?.(done, names.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  await flushRegistryCache();
  return out;
};

export interface VersionDetails {
  description?: string;
  homepage?: string;
  repository?: string;
  license?: string;
}

/**
 * A `repository` field as a page a browser can open. package.json allows several spellings —
 * `github:owner/repo`, `gitlab:…`, `bitbucket:…`, a bare `owner/repo` (GitHub), and git URLs over
 * `git+https`, `git+ssh`, `git://` or scp-style `git@host:owner/repo` — and only an https URL is
 * worth a link. Undefined for anything that does not resolve to one.
 */
export const repositoryWebUrl = (value: string): string | undefined => {
  const trimmed = value.trim();
  const hosts: Record<string, string> = {
    github: 'github.com',
    gitlab: 'gitlab.com',
    bitbucket: 'bitbucket.org',
  };
  const shorthand = trimmed.match(/^(github|gitlab|bitbucket):([\w.-]+\/[\w.-]+)$/);
  if (shorthand?.[1] && shorthand[2]) return `https://${hosts[shorthand[1]]}/${shorthand[2]}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) return `https://github.com/${trimmed}`;
  const url = trimmed
    .replace(/^git\+/, '')
    .replace(/^(ssh|git):\/\/(?:[\w.-]+@)?([\w.-]+)(?::\d+)?\//, 'https://$2/')
    .replace(/^[\w.-]+@([\w.-]+):/, 'https://$1/')
    .replace(/\.git(#.*)?$/, '$1')
    .replace(/#.*$/, '');
  return /^https?:\/\//.test(url) ? url : undefined;
};

const detailsMemo = new Map<string, Promise<VersionDetails>>();

/**
 * The description, homepage and licence of one version — its manifest alone (`/<name>/<version>`),
 * a few KB, fetched for the package in view only. Kept for the session, not on disk.
 */
export const getVersionDetails = (
  name: string,
  version: string,
  registry: string,
): Promise<VersionDetails> => {
  const key = `${registry}|${name}@${version}`;
  const known = detailsMemo.get(key);
  if (known) return known;
  const pending = fetch(`${registry}/${encodeName(name)}/${encodeURIComponent(version)}`)
    .then((response) => (response.ok ? response.json() : {}))
    .then((doc: Record<string, unknown>) => {
      const repository = doc.repository as { url?: string } | string | undefined;
      const rawRepository = typeof repository === 'string' ? repository : repository?.url;
      return {
        description: typeof doc.description === 'string' ? doc.description : undefined,
        homepage: typeof doc.homepage === 'string' ? doc.homepage : undefined,
        repository: rawRepository ? repositoryWebUrl(rawRepository) : undefined,
        license: typeof doc.license === 'string' ? doc.license : undefined,
      };
    })
    .catch(() => ({}));
  detailsMemo.set(key, pending);
  return pending;
};

const timesMemo = new Map<string, Promise<Record<string, string>>>();

/**
 * When each version was published — only in the *full* document, which can be large, so it is
 * used by maintenance assessment and the version picker, and kept for the session.
 */
export const getPublishTimes = (
  name: string,
  registry: string,
  force = false,
): Promise<Record<string, string>> => {
  const key = `${registry}|${name}`;
  const known = timesMemo.get(key);
  if (known) return known;
  const pending = fetch(`${registry}/${encodeName(name)}`)
    .then((response) => (response.ok ? response.json() : {}))
    .then((doc: { time?: Record<string, string> }) => doc.time ?? {})
    .catch(() => ({}));
  timesMemo.set(key, pending);
  return pending;
};

export interface SearchResult {
  name: string;
  version: string;
  description?: string;
  date?: string;
}

/** The registry's search, for adding a package that is not in `package.json` yet. */
export const searchPackages = async (query: string, registry: string): Promise<SearchResult[]> => {
  if (query.trim().length < 2) return [];
  const response = await fetch(
    `${registry}/-/v1/search?text=${encodeURIComponent(query.trim())}&size=25`,
  );
  if (!response.ok) throw new Error(`registry search answered ${response.status}`);
  const data = (await response.json()) as {
    objects?: { package: { name: string; version: string; description?: string; date?: string } }[];
  };
  return (data.objects ?? []).map(({ package: pkg }) => ({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    date: pkg.date,
  }));
};

/** The last stable release of each major line — `{ 18: '2024-04-26T…', 19: … }`. */
export type ReleaseLines = Record<number, string>;

/** Fold a package's publish times into {@link ReleaseLines}; prereleases don't keep a line alive. */
export const toReleaseLines = (times: Record<string, string>): ReleaseLines => {
  const lines: ReleaseLines = {};
  for (const [version, time] of Object.entries(times)) {
    if (
      !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) ||
      isPrerelease(version) ||
      !Number.isFinite(Date.parse(time))
    )
      continue;
    const major = Number.parseInt(version, 10);
    if (Number.isNaN(major)) continue;
    const known = lines[major];
    if (!known || time > known) lines[major] = time;
  }
  return lines;
};

export interface ReleaseActivity {
  published: Record<string, string>;
  lines: ReleaseLines;
  lastPublished?: string;
}

export const toReleaseActivity = (times: Record<string, string>): ReleaseActivity => ({
  published: Object.fromEntries(
    Object.entries(times).filter(
      ([version, time]) =>
        /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) &&
        Number.isFinite(Date.parse(time)),
    ),
  ),
  lines: toReleaseLines(times),
  lastPublished: Object.entries(times)
    .filter(
      ([version, time]) =>
        /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) &&
        Number.isFinite(Date.parse(time)),
    )
    .map(([, time]) => time)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0],
});

const LINES_FILE = () => join(pkgiCacheDir(), 'release-lines.json');
/** Old lines only ever get fewer releases; a week-old answer is still right. */
const LINES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let linesCache:
  | Record<string, { fetchedAt: number; lines: ReleaseLines; activity?: ReleaseActivity }>
  | undefined;

/**
 * Exact publish activity from the full registry document. Only the compact result is cached
 * on disk for a week. Older line-only cache entries are refreshed to obtain package activity.
 */
export const getReleaseActivity = async (
  name: string,
  registry: string,
  force = false,
): Promise<ReleaseActivity | undefined> => {
  if (!linesCache) {
    try {
      linesCache = JSON.parse(await Bun.file(LINES_FILE()).text());
    } catch {
      linesCache = {};
    }
  }
  const store = linesCache ?? {};
  const key = cacheKey(registry, name);
  const cached = store[key];
  if (cached?.activity?.published && !force && Date.now() - cached.fetchedAt < LINES_MAX_AGE_MS)
    return cached.activity;
  const times = await getPublishTimes(name, registry, force);
  if (!Object.keys(times).length) return cached?.activity;
  const activity = toReleaseActivity(times);
  store[key] = { fetchedAt: Date.now(), lines: activity.lines, activity };
  try {
    await mkdir(pkgiCacheDir(), { recursive: true });
    const temporary = `${LINES_FILE()}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify(store));
    await rename(temporary, LINES_FILE());
  } catch {}
  return activity;
};

export const getReleaseLines = async (name: string, registry: string, force = false) =>
  (await getReleaseActivity(name, registry, force))?.lines;

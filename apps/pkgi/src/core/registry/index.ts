import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  fetchedAt: number;
  /** `not-found` for a package the registry does not have (a private or local one). */
  error?: string;
}

export interface RegistryOptions {
  registry: string;
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
export const getPackageInfo = async (
  name: string,
  { registry, maxAgeMs, force = false }: RegistryOptions,
): Promise<PackageInfo> => {
  const store = await loadCache();
  const key = cacheKey(registry, name);
  const cached = store[key];
  if (cached && !force && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

  try {
    const response = await fetch(`${registry}/${encodeName(name)}`, {
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
      return {
        description: typeof doc.description === 'string' ? doc.description : undefined,
        homepage: typeof doc.homepage === 'string' ? doc.homepage : undefined,
        repository:
          typeof repository === 'string'
            ? repository
            : repository?.url?.replace(/^git\+/, '').replace(/\.git$/, ''),
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
 * fetched only when the version picker is opened on a package, and kept for the session.
 */
export const getPublishTimes = (
  name: string,
  registry: string,
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

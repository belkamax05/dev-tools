import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { pkgiCacheDir } from '../../config/paths';
import { parseVersion } from '../semver';

/**
 * npm package → endoflife.date product, for the packages whose support window is published
 * there. Several packages map to one product: `@types/node` follows Node's releases, every
 * `react-*` companion follows React's.
 */
export const ENDOFLIFE_PRODUCTS: Record<string, string> = {
  node: 'nodejs',
  '@types/node': 'nodejs',
  next: 'nextjs',
  react: 'react',
  'react-dom': 'react',
  '@types/react': 'react',
  '@types/react-dom': 'react',
  '@angular/core': 'angular',
  angular: 'angular',
  vue: 'vue',
  nuxt: 'nuxt',
  typescript: 'typescript',
  eslint: 'eslint',
  webpack: 'webpack',
  vite: 'vite',
  nx: 'nx',
  cypress: 'cypress',
  jest: 'jest',
  storybook: 'storybook',
  '@storybook/react': 'storybook',
  '@storybook/react-vite': 'storybook',
  sass: 'sass',
  express: 'express',
  electron: 'electron',
  svelte: 'svelte',
  '@sveltejs/kit': 'sveltekit',
  jquery: 'jquery',
  bootstrap: 'bootstrap',
  tailwindcss: 'tailwind-css',
  'ember-source': 'emberjs',
  '@nestjs/core': 'nestjs',
  'react-native': 'react-native',
};

export interface EolCycle {
  cycle: string;
  /** A date, or `true`/`false` for "already" / "not announced". */
  eol: string | boolean;
  lts?: string | boolean;
  latest?: string;
  releaseDate?: string;
}

export type SupportStatus = 'supported' | 'ending' | 'eol' | 'unknown';

export interface SupportInfo {
  status: SupportStatus;
  product: string;
  cycle?: string;
  /** Plain-language summary: "supported until 2026-04-30", "end of life since 2025-04-30". */
  summary: string;
  lts: boolean;
  source: string;
}

interface EolCache {
  [product: string]: { fetchedAt: number; cycles: EolCycle[] };
}

const CACHE_FILE = () => join(pkgiCacheDir(), 'endoflife.json');
/** Support windows change a few times a year — a week-old answer is still right. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** "Ending" when the end is this close. */
const SOON_MS = 90 * 24 * 60 * 60 * 1000;

let cache: EolCache | undefined;

const loadCache = async (): Promise<EolCache> => {
  if (cache) return cache;
  try {
    cache = JSON.parse(await Bun.file(CACHE_FILE()).text()) as EolCache;
  } catch {
    cache = {};
  }
  return cache;
};

const saveCache = async () => {
  if (!cache) return;
  try {
    await mkdir(pkgiCacheDir(), { recursive: true });
    const temporary = `${CACHE_FILE()}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(cache));
    await rename(temporary, CACHE_FILE());
  } catch {}
};

const fetchCycles = async (product: string, force: boolean): Promise<EolCycle[] | undefined> => {
  const store = await loadCache();
  const cached = store[product];
  if (cached && !force && Date.now() - cached.fetchedAt < MAX_AGE_MS) return cached.cycles;
  try {
    const response = await fetch(`https://endoflife.date/api/${product}.json`);
    if (!response.ok) return cached?.cycles;
    const cycles = (await response.json()) as EolCycle[];
    store[product] = { fetchedAt: Date.now(), cycles };
    await saveCache();
    return cycles;
  } catch {
    return cached?.cycles;
  }
};

/**
 * The release line a version belongs to: endoflife.date names cycles by major (`18`) for most
 * products and by major.minor (`5.4`) for some, so both are tried, the more specific first.
 */
export const findCycle = (cycles: EolCycle[], version: string): EolCycle | undefined => {
  const parsed = parseVersion(version);
  if (!parsed) return undefined;
  return (
    cycles.find((cycle) => cycle.cycle === `${parsed.major}.${parsed.minor}`) ??
    cycles.find((cycle) => cycle.cycle === String(parsed.major))
  );
};

export const describeCycle = (
  product: string,
  cycle: EolCycle | undefined,
  now = Date.now(),
): SupportInfo => {
  const source = `https://endoflife.date/${product}`;
  if (!cycle) {
    return { status: 'unknown', product, summary: 'release line not listed', lts: false, source };
  }
  const lts = Boolean(cycle.lts);
  if (cycle.eol === true) {
    return {
      status: 'eol',
      product,
      cycle: cycle.cycle,
      summary: `${cycle.cycle} is end of life`,
      lts,
      source,
    };
  }
  if (cycle.eol === false) {
    return {
      status: 'supported',
      product,
      cycle: cycle.cycle,
      summary: `${cycle.cycle} is supported`,
      lts,
      source,
    };
  }
  const end = Date.parse(cycle.eol);
  if (Number.isNaN(end)) {
    return {
      status: 'unknown',
      product,
      cycle: cycle.cycle,
      summary: String(cycle.eol),
      lts,
      source,
    };
  }
  if (end <= now) {
    return {
      status: 'eol',
      product,
      cycle: cycle.cycle,
      summary: `${cycle.cycle} end of life since ${cycle.eol}`,
      lts,
      source,
    };
  }
  return {
    status: end - now < SOON_MS ? 'ending' : 'supported',
    product,
    cycle: cycle.cycle,
    summary: `${cycle.cycle} supported until ${cycle.eol}`,
    lts,
    source,
  };
};

/**
 * The support status of the installed version of a package, for the packages endoflife.date
 * tracks; undefined for the rest (most of them). Deprecation is a separate, per-version signal
 * and comes from the registry instead.
 */
export const getSupport = async (
  name: string,
  version: string,
  force = false,
): Promise<SupportInfo | undefined> => {
  const product = ENDOFLIFE_PRODUCTS[name];
  if (!product) return undefined;
  const cycles = await fetchCycles(product, force);
  if (!cycles) return undefined;
  return describeCycle(product, findCycle(cycles, version));
};

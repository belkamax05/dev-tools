import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { pkgiCacheDir } from '../../config/paths';
import { parseVersion } from '../semver';

/**
 * npm package → endoflife.date product, for the packages whose support window is published
 * there. Several packages map to one product when they are released in lockstep with it:
 * `@types/node` follows Node's releases, `react-dom` React's, every `@angular/*` Angular's.
 *
 * Only products endoflife.date actually has (https://endoflife.date/api/all.json) — a name that
 * isn't there answers 404 and the package silently gets no verdict. Everything not listed is
 * judged from the registry instead (see core/support).
 */
export const ENDOFLIFE_PRODUCTS: Record<string, string> = {
  node: 'nodejs',
  '@types/node': 'nodejs',
  next: 'nextjs',
  'eslint-config-next': 'nextjs',
  '@next/eslint-plugin-next': 'nextjs',
  '@next/bundle-analyzer': 'nextjs',
  '@next/third-parties': 'nextjs',
  '@next/mdx': 'nextjs',
  '@next/env': 'nextjs',
  react: 'react',
  'react-dom': 'react',
  'react-is': 'react',
  'react-test-renderer': 'react',
  '@types/react': 'react',
  '@types/react-dom': 'react',
  'react-native': 'react-native',
  '@angular/core': 'angular',
  '@angular/common': 'angular',
  '@angular/compiler': 'angular',
  '@angular/compiler-cli': 'angular',
  '@angular/platform-browser': 'angular',
  '@angular/platform-browser-dynamic': 'angular',
  '@angular/platform-server': 'angular',
  '@angular/router': 'angular',
  '@angular/forms': 'angular',
  '@angular/animations': 'angular',
  '@angular/cli': 'angular',
  //? The `angular` package is AngularJS (1.x), a different product
  angular: 'angularjs',
  vue: 'vue',
  '@vue/compiler-sfc': 'vue',
  '@vue/server-renderer': 'vue',
  vuetify: 'vuetify',
  nuxt: 'nuxt',
  svelte: 'svelte',
  eslint: 'eslint',
  '@eslint/js': 'eslint',
  electron: 'electron',
  express: 'express',
  jquery: 'jquery',
  'jquery-ui': 'jquery-ui',
  bootstrap: 'bootstrap',
  tailwindcss: 'tailwind-css',
  '@tailwindcss/postcss': 'tailwind-css',
  '@tailwindcss/vite': 'tailwind-css',
  '@tailwindcss/cli': 'tailwind-css',
  'ember-source': 'emberjs',
  '@ionic/core': 'ionic',
  '@ionic/angular': 'ionic',
  '@ionic/react': 'ionic',
  '@ionic/vue': 'ionic',
  '@types/bun': 'bun',
  'bun-types': 'bun',
  pnpm: 'pnpm',
  yarn: 'yarn',
};

export interface EolCycle {
  cycle: string;
  /** A date, or `true`/`false` for "already" / "not announced". */
  eol: string | boolean;
  lts?: string | boolean;
  latest?: string;
  releaseDate?: string;
}

/**
 * `stale` is the registry's verdict, never endoflife.date's: no vendor says it is unsupported,
 * but nothing has been released for it in a long time (see core/support).
 */
export type SupportStatus = 'supported' | 'ending' | 'eol' | 'stale' | 'unknown';

export interface SupportInfo {
  status: SupportStatus;
  /** The endoflife.date product, or `npm` for a verdict read from the registry. */
  product: string;
  /** Where the verdict comes from: a published support window, or release dates. */
  basis: 'endoflife' | 'registry';
  cycle?: string;
  /** Plain-language summary: "supported until 2026-04-30", "end of life since 2025-04-30". */
  summary: string;
  /** The end of support (`YYYY-MM-DD`) when one is published. */
  until?: string;
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
  const basis = 'endoflife' as const;
  if (!cycle) {
    return {
      status: 'unknown',
      product,
      basis,
      summary: 'release line not listed',
      lts: false,
      source,
    };
  }
  const lts = Boolean(cycle.lts);
  if (cycle.eol === true) {
    return {
      status: 'eol',
      product,
      basis,
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
      basis,
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
      basis,
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
      basis,
      cycle: cycle.cycle,
      summary: `${cycle.cycle} end of life since ${cycle.eol}`,
      until: cycle.eol,
      lts,
      source,
    };
  }
  return {
    status: end - now < SOON_MS ? 'ending' : 'supported',
    product,
    basis,
    cycle: cycle.cycle,
    summary: `${cycle.cycle} supported until ${cycle.eol}`,
    until: cycle.eol,
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

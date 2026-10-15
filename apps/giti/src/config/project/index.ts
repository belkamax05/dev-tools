import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { IgnoredOptions } from '../../core/ignored';

/** The file names looked for, in order. `.ts` is the documented one; the rest are for projects without TS. */
export const PROJECT_CONFIG_NAMES = ['giti.config.ts', 'giti.config.mjs', 'giti.config.js'] as const;

/**
 * What a `giti.config.ts` may export — an object, or a function of the repository giti is
 * working on, for a config that serves several repositories (a wrapping tool's, say) and keeps
 * a rule to the ones it belongs to.
 *
 * ```ts
 * // giti.config.ts
 * export default {
 *   clear: {
 *     preselect: ['**\/dist', '**\/.next'],  // ticked when `giti clear` opens
 *     hide: ['.env*'],                       // never listed
 *   },
 * };
 * ```
 */
export interface GitiProjectConfig {
  clear?: IgnoredOptions;
}

export interface GitiConfigContext {
  /** Top of the work tree giti is operating on. */
  root: string;
}

export type GitiConfigExport =
  | GitiProjectConfig
  | ((context: GitiConfigContext) => GitiProjectConfig | Promise<GitiProjectConfig>);

export interface ClearOptionsResult {
  options: IgnoredOptions;
  /** The config files the rules came from, nearest first. */
  paths: string[];
  /** One line per file that could not be used — reported rather than thrown. */
  errors: string[];
}

/** The nearest config file at or above `dir`, the way git finds its repository. */
export const findProjectConfig = (dir: string): string | undefined => {
  let current = resolve(dir);
  while (true) {
    for (const name of PROJECT_CONFIG_NAMES) {
      const candidate = join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * `giti clear`'s hide / preselect rules for the repository at `root`.
 *
 * Two sources, merged: the nearest `giti.config.ts` at or above the repository, and the file
 * `GITI_CONFIG` names. The second is for a tool that runs giti on behalf of repositories it does
 * not own — `dfs fe git clear` points it at dfs-fe-internal's config while working in dfs-fe,
 * where walking up would never find it. Imported rather than parsed, so a config can compute its
 * rules; a file that throws costs its own rules, not the run.
 */
export const loadClearOptions = async (
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ClearOptionsResult> => {
  const named = env.GITI_CONFIG ? resolve(env.GITI_CONFIG) : undefined;
  const candidates = [findProjectConfig(root), named].filter(
    (path, at, all): path is string => Boolean(path) && all.indexOf(path) === at,
  );

  const hide: string[] = [];
  const preselect: string[] = [];
  const paths: string[] = [];
  const errors: string[] = [];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) throw new Error('file not found');
      const module = await import(pathToFileURL(path).href);
      const exported = (module.default ?? module.config ?? module) as GitiConfigExport;
      const config = typeof exported === 'function' ? await exported({ root }) : exported;
      hide.push(...strings(config?.clear?.hide));
      preselect.push(...strings(config?.clear?.preselect));
      paths.push(path);
    } catch (error) {
      errors.push(`${path}: ${(error as Error).message}`);
    }
  }
  return { options: { hide, preselect }, paths, errors };
};

/** Two sets of rules as one — a config's, then the flags typed on top of it. */
export const mergeClearOptions = (...all: IgnoredOptions[]): IgnoredOptions => ({
  hide: all.flatMap((options) => options.hide ?? []),
  preselect: all.flatMap((options) => options.preselect ?? []),
});

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The file names looked for, in order. `.ts` is the documented one. */
export const PROJECT_CONFIG_NAMES = [
  'proji.config.ts',
  'proji.config.mjs',
  'proji.config.js',
] as const;

/**
 * One alias: a shell command run in the project root with the caller's arguments appended, or
 * another package.json script of the same project (run through its package manager).
 */
export type AliasSpec =
  | string
  | { run: string; description?: string }
  | { script: string; description?: string };

export interface ProjectSpec {
  /** Folder of the project, relative to the config file. */
  root: string;
  /** Header for its picker; defaults to the project's name. */
  title?: string;
  commands?: Record<string, AliasSpec>;
}

/**
 * What a `proji.config.ts` may export.
 *
 * ```ts
 * export default {
 *   // aliases for the project the file sits in
 *   commands: { install: 'pkgi install', check: { script: 'lint:all' } },
 *   // other projects, by name - `proji fe` opens ../dfs-fe with its own aliases
 *   projects: { fe: { root: '../dfs-fe', commands: { lint: { script: 'lint:all' } } } },
 * };
 * ```
 */
export interface ProjiConfig {
  commands?: Record<string, AliasSpec>;
  projects?: Record<string, ProjectSpec>;
}

export interface LoadedConfig {
  config: ProjiConfig;
  /** The file it came from, when there is one. */
  path?: string;
  /** Why the file could not be used — reported rather than thrown. */
  error?: string;
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

/**
 * The nearest `proji.config.ts`. `PROJI_PROJECT_DIR` names the project outright, for a tool that
 * runs proji on behalf of one repository from wherever its user is. Imported rather than
 * parsed, so a config can compute its paths. A broken file costs its aliases, not the run.
 */
export const loadConfig = async (
  dir = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<LoadedConfig> => {
  const path = findProjectConfig(env.PROJI_PROJECT_DIR || dir);
  if (!path) return { config: {} };
  try {
    const module = await import(pathToFileURL(path).href);
    const config = (module.default ?? module.config ?? module) as ProjiConfig | undefined;
    if (!config || typeof config !== 'object')
      return { config: {}, path, error: 'exports nothing' };
    return { config, path };
  } catch (error) {
    return { config: {}, path, error: (error as Error).message };
  }
};

/** A named project of the config, with its root made absolute against the config file. */
export const resolveNamedProject = (loaded: LoadedConfig, name: string) => {
  const spec = loaded.config.projects?.[name];
  if (!spec || !loaded.path) return undefined;
  return { ...spec, root: resolve(dirname(loaded.path), spec.root) };
};

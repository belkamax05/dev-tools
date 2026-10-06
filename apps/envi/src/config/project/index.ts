import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { coerceVars } from '../settings';

/** The file names looked for in each folder, in order. `.ts` is the documented one. */
export const PROJECT_CONFIG_NAMES = [
  'env.config.ts',
  'env.config.mts',
  'env.config.js',
  'env.config.mjs',
] as const;

/**
 * What an `env.config.ts` may export — the object itself, or a function returning it (sync or
 * async) for a config that computes its values.
 *
 * ```ts
 * // env.config.ts
 * export default {
 *   files: ['.env.shared'],           // read after your own list, relative to this file
 *   disable: ['.env.user'],           // files not to read here
 *   vars: { API_URL: 'http://localhost:${PORT:-3000}' },
 *   required: ['DATABASE_URL'],       // `envi check` fails while one is unset
 * };
 * ```
 */
export interface EnviProjectConfig {
  files?: string[];
  disable?: string[];
  vars?: Record<string, string | number | boolean>;
  required?: string[];
  /** Same as the user setting, for this folder and below. */
  override?: boolean;
}

export interface ProjectConfigContext {
  /** Where envi runs. */
  cwd: string;
  /** The workspace root: the nearest folder at or above `cwd` with a `.git`. */
  root: string;
  /** The folder this config file is in. */
  dir: string;
  /** The shell's environment, before envi applies anything. */
  env: Readonly<Record<string, string>>;
}

export type EnviProjectConfigExport =
  | EnviProjectConfig
  | ((context: ProjectConfigContext) => EnviProjectConfig | Promise<EnviProjectConfig>);

/** Typing help for an `env.config.ts`; returns its argument. */
export const defineConfig = <T extends EnviProjectConfigExport>(config: T): T => config;

export interface ProjectConfig {
  path: string;
  dir: string;
  files: string[];
  disable: string[];
  vars: Record<string, string>;
  required: string[];
  override?: boolean;
  /** Why the file could not be used — reported rather than thrown. */
  error?: string;
}

/** The nearest folder at or above `dir` that has a `.git` (folder or worktree file), or `dir`. */
export const findWorkspaceRoot = (dir: string): string => {
  const start = resolve(dir);
  let current = start;
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
};

/** Every folder from `root` down to `cwd`, root first. Just `cwd` when it is not under `root`. */
export const foldersBetween = (root: string, cwd: string): string[] => {
  const rel = relative(root, cwd);
  if (rel.startsWith('..') || resolve(rel) === rel) return [cwd];
  const folders = [root];
  let current = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    folders.push(current);
  }
  return folders;
};

export const findProjectConfigs = (root: string, cwd: string): string[] =>
  foldersBetween(root, cwd).flatMap((dir) => {
    const name = PROJECT_CONFIG_NAMES.find((candidate) => existsSync(join(dir, candidate)));
    return name ? [join(dir, name)] : [];
  });

const strings = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];

/**
 * Import one `env.config.ts`. Dropped from the module cache first, so the dashboard picks up an
 * edit on refresh rather than serving what it imported at start. A file that throws or exports
 * something else costs its own settings, never the run.
 */
export const loadProjectConfig = async (
  path: string,
  context: Omit<ProjectConfigContext, 'dir'>,
): Promise<ProjectConfig> => {
  const dir = dirname(path);
  const empty: ProjectConfig = {
    path,
    dir,
    files: [],
    disable: [],
    vars: {},
    required: [],
  };
  try {
    delete require.cache[path];
    const module = await import(path);
    let raw = (module.default ?? module.config ?? module) as EnviProjectConfigExport | undefined;
    if (typeof raw === 'function') raw = await raw({ ...context, dir });
    if (!raw || typeof raw !== 'object') return { ...empty, error: 'exports no config object' };
    return {
      path,
      dir,
      files: strings(raw.files),
      disable: strings(raw.disable),
      vars: coerceVars(raw.vars),
      required: strings(raw.required),
      ...(typeof raw.override === 'boolean' && { override: raw.override }),
    };
  } catch (error) {
    return { ...empty, error: (error as Error).message };
  }
};

/** Every `env.config.ts` from the workspace root down to `cwd`, root first — nearer ones win. */
export const loadProjectConfigs = async (
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<{ root: string; configs: ProjectConfig[] }> => {
  const root = findWorkspaceRoot(cwd);
  const configs: ProjectConfig[] = [];
  //? One after another, not in parallel: order is precedence, and a later config may well
  //? read a file an earlier one generates
  for (const path of findProjectConfigs(root, cwd)) {
    configs.push(await loadProjectConfig(path, { cwd, root, env }));
  }
  return { root, configs };
};

export const PROJECT_CONFIG_TEMPLATE = `/**
 * envi's settings for this folder and everything below it — see \`envi help\`.
 * Nearer env.config.ts files win over the ones above them, up to the git root.
 */
export default {
  // Env files read after your own list (.env, .env.user), relative to this file.
  files: [],
  // Files not to read here: '.env.user', or a path.
  disable: [],
  // Variables for everyone in this workspace; they win over every .env file.
  vars: {
    // API_URL: 'http://localhost:\${PORT:-3000}',
  },
  // Names \`envi check\` insists on.
  required: [],
};
`;

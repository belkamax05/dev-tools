import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { DeployPlugin } from '../../core/plugin';

/** The file names looked for, in order. `.ts` is the documented one. */
export const PROJECT_CONFIG_NAMES = [
  'depli.config.ts',
  'depli.config.mjs',
  'depli.config.js',
] as const;

/**
 * What a project's `depli.config.ts` may export.
 *
 * ```ts
 * // depli.config.ts
 * export default {
 *   targets: {
 *     jenkins: { url: 'https://jenkins.example.com', job: 'web/job/deploy', tokenEnv: 'MY_TOKEN' },
 *     github: { repo: 'owner/name', workflow: 'deploy.yml' },
 *   },
 *   plugins: [myPlugin],   // added, or replacing a built-in with the same id
 *   disable: ['github'],   // built-ins not offered here
 * };
 * ```
 */
export interface DepliProjectConfig {
  targets?: Record<string, Record<string, unknown>>;
  plugins?: DeployPlugin<any>[];
  disable?: string[];
}

/** Typing help for a `depli.config.ts`; returns its argument. */
export const defineConfig = (config: DepliProjectConfig): DepliProjectConfig => config;

export interface ProjectConfigResult {
  config: DepliProjectConfig;
  /** The folder the file is in — the project deploys run from. */
  dir: string;
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
 * The nearest `depli.config.ts`. `DEPLI_PROJECT_DIR` names the project outright, as
 * `PORTI_PROJECT_DIR` does for porti, for a tool that runs depli on behalf of one repository.
 */
export const loadProjectConfig = async (
  dir = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<ProjectConfigResult> => {
  const start = env.DEPLI_PROJECT_DIR || dir;
  const path = findProjectConfig(start);
  if (!path) return { config: {}, dir: resolve(start) };
  try {
    const module = await import(pathToFileURL(path).href);
    const config = (module.default ?? module.config ?? {}) as DepliProjectConfig;
    return { config, dir: dirname(path), path };
  } catch (error) {
    return { config: {}, dir: dirname(path), path, error: (error as Error).message };
  }
};

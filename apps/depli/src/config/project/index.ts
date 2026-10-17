import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ProviderPlugin, StepConfig } from '../../core/plugin';

/** The file names looked for, in order. `.ts` is the documented one. */
export const PROJECT_CONFIG_NAMES = [
  'depli.config.ts',
  'depli.config.mjs',
  'depli.config.js',
] as const;

/** One provider instance: which plugin, and its options (URLs, which env vars hold secrets…). */
export interface ProviderConfig {
  plugin: string;
  /** Transport ids in order of preference; the plugin's own order when unset. */
  transports?: string[];
  [option: string]: unknown;
}

export interface EnvConfig {
  id: string;
  label?: string;
  /**
   * Never auto-proceeds into or through it, and every trigger needs its own confirmation — even
   * when auto-proceed or one-click chains are on.
   */
  protected?: boolean;
}

export interface TriggerConfig {
  /** Off: plans are shown as dry runs and nothing is ever sent. */
  enabled?: boolean;
  /** Opt-in: start the next step when one succeeds (stops before a protected env). */
  autoProceed?: boolean;
}

/**
 * What a project's `depli.config.ts` may export.
 *
 * ```ts
 * export default defineConfig({
 *   repo: { path: '~/code/app' },
 *   branches: { watch: ['main', 'release-*'] },
 *   providers: {
 *     github: { plugin: 'github', repo: 'owner/app' },
 *     jenkins: { plugin: 'jenkins', url: 'https://ci.example.com', userEnv: 'CI_USER', tokenEnv: 'CI_TOKEN' },
 *   },
 *   envs: [{ id: 'qa' }, { id: 'prod', protected: true }],
 *   pipeline: [
 *     { id: 'push', label: 'Push', provider: 'github', kind: 'branch' },
 *     { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job', job: 'build', after: ['push'] },
 *   ],
 * });
 * ```
 */
/**
 * Which of the provider's branches the Branches tab lists, by their newest commit — read from the
 * provider (GitHub), never from a local checkout.
 */
export interface BranchRecentRule {
  /** How many to show (default 12) — required and `atLeast` picks first, the newest fill up. */
  limit?: number;
  /** Always listed when they exist, however old (`master`, `develop`). */
  required?: string[];
  /** At least `count` of the newest branches matching `patterns` (globs). */
  atLeast?: Array<{ patterns: string[]; count: number }>;
}

export interface DepliProjectConfig {
  /** The checkout shown beside the branch (`B` jumps back to it); it preselects nothing. */
  repo?: { path?: string };
  branches?: {
    /** Glob patterns shown first, and the ones polled; every other branch is still reachable. */
    watch?: string[];
    /** When set, the Branches tab lists these instead of `watch`. */
    recent?: BranchRecentRule;
    /** Which provider instance lists branches; the first that can when unset. */
    provider?: string;
  };
  providers?: Record<string, ProviderConfig>;
  envs?: EnvConfig[];
  defaultEnv?: string;
  pipeline?: StepConfig[];
  triggers?: TriggerConfig;
  /** Added — or replacing a built-in, by reusing its id. */
  plugins?: ProviderPlugin<any>[];
  /** Seconds between connection probes; 0 switches polling off. */
  pollSeconds?: number;
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

export const expandHome = (path: string): string =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

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

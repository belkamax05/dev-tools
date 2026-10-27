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
  /**
   * Transport ids switched off for this project: still listed (greyed) in the Connections tab,
   * but never probed, used or pickable — e.g. a limited fallback the project does not want.
   */
  disabledTransports?: string[];
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
  /** The env's own site — opened from the Environments view (`w`, or a click on its name). */
  url?: string;
  /**
   * Branches (globs, `!` excludes) the env is meant to run — the project's branch relations. The
   * Environments view shows them as what each env is meant for, and tags an env on anything
   * else `off-track`.
   */
  branches?: string[];
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
    /**
     * Where that provider reads them, when it is not a repository — Jenkins:
     * `{ job: 'build_ts-app', param: 'CODE_BRANCH' }`, the job's choice list and the branches it
     * built.
     */
    source?: Record<string, unknown>;
    /**
     * The picker also takes a name typed into its filter that is not listed — for a list that is
     * not every branch (a Jenkins choice list); a trigger offers to add it where it is refused.
     */
    custom?: boolean;
  };
  /**
   * Branches picked in another flow that this one shows and uses — `{ fe: { flow: 'fe' } }`: the
   * fe flow's pick, read-only here. Steps run on one with `branchFrom: 'fe'`; params get them as
   * `input.branches.fe`.
   */
  linkedBranches?: Record<string, { flow: string; label?: string }>;
  providers?: Record<string, ProviderConfig>;
  envs?: EnvConfig[];
  defaultEnv?: string;
  pipeline?: StepConfig[];
  triggers?: TriggerConfig;
  /** Added — or replacing a built-in, by reusing its id. */
  plugins?: ProviderPlugin<any>[];
  /** Seconds between connection probes; 0 switches polling off. */
  pollSeconds?: number;
  /**
   * The command that stores environment variables, given `KEY=VALUE` arguments — how a guided
   * setup (the Jenkins login) saves what it asked for. `['dfs', 'env', 'set']` for dfs; envi's own
   * `envi set` when unset. Either writes where envi's setTarget setting says.
   */
  envSet?: string[];
  /**
   * Several deploy flows in one file — e.g. `fe` and `be`, each with its own repo, branches,
   * envs and pipeline. A flow is a config of its own laid over the top-level one: its keys replace
   * the shared ones, except `providers`, which are merged by name. One flow is open at a time —
   * `depli --flow=<id>` (or `depli <id>`, or `DEPLI_FLOW`), else `defaultFlow`, else the first.
   */
  flows?: Record<string, FlowConfig>;
  /** The flow opened when none is named; the first in `flows` when unset. */
  defaultFlow?: string;
}

/** One flow of a multi-flow config: a project config of its own, minus the flow keys. */
export interface FlowConfig extends Omit<DepliProjectConfig, 'flows' | 'defaultFlow'> {
  /** Shown beside the project name; the flow's id when unset. */
  label?: string;
}

export interface ResolvedFlow {
  /** The config of the flow chosen, shared keys included — what the rest of depli reads. */
  config: DepliProjectConfig;
  /** Its id; undefined for a config without `flows`. */
  flow?: string;
  /** Its `label`, else its id. */
  label?: string;
  /** Every flow id, in file order; empty for a config without `flows`. */
  flows: string[];
  /** Why the flow asked for (or `defaultFlow`) could not be used — the fallback is opened. */
  error?: string;
}

/**
 * The config of one flow: the top-level keys with the flow's own laid over them (`providers`
 * merged by name). A config without `flows` is returned as it is, whatever is asked.
 */
export const resolveFlow = (config: DepliProjectConfig, requested?: string): ResolvedFlow => {
  const { flows: byId, defaultFlow, ...shared } = config;
  const flows = Object.keys(byId ?? {});
  if (!byId || !flows.length) return { config, flows };
  const unknown = (id: string) => `no flow "${id}" — flows: ${flows.join(', ')}`;
  const fallback = defaultFlow && byId[defaultFlow] ? defaultFlow : flows[0]!;
  const flow = requested && byId[requested] ? requested : fallback;
  const { label, ...own } = byId[flow]!;
  const error =
    requested && !byId[requested]
      ? unknown(requested)
      : defaultFlow && !byId[defaultFlow]
        ? `defaultFlow: ${unknown(defaultFlow)}`
        : undefined;
  return {
    config: { ...shared, ...own, providers: { ...shared.providers, ...own.providers } },
    flow,
    label: label ?? flow,
    flows,
    error,
  };
};

/** Typing help for a `depli.config.ts`; returns its argument. */
export const defineConfig = (config: DepliProjectConfig): DepliProjectConfig => config;

/**
 * The environment variables the providers read their secrets from — every `…Env` option
 * (`userEnv`, `tokenEnv`). What a launcher has to provide, and all it needs to: `dfs deploy`
 * asks envi for just these.
 */
export const secretEnvNames = (config: DepliProjectConfig): string[] => [
  ...new Set(
    [
      config.providers ?? {},
      //? Every flow's too — the launcher does not know which flow will be opened
      ...Object.values(config.flows ?? {}).map((flow) => flow.providers ?? {}),
    ]
      .flatMap((providers) => Object.values(providers))
      .flatMap((provider) =>
        Object.entries(provider)
          .filter(([option, value]) => /Env$/.test(option) && typeof value === 'string' && value)
          .map(([, value]) => value as string),
      ),
  ),
];

export interface ProjectConfigResult {
  /** The config of the flow opened (see `resolveFlow`) — the file's own when it has no flows. */
  config: DepliProjectConfig;
  /** The file's export as it is, every flow included. */
  raw: DepliProjectConfig;
  /** The flow opened; undefined for a config without `flows`. */
  flow?: string;
  /** Its `label`, else its id. */
  flowLabel?: string;
  /** Every flow id, in file order; empty for a config without `flows`. */
  flows: string[];
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
 * `DEPLI_FLOW` picks the flow of a multi-flow config (`depli --flow=<id>` sets it).
 */
export const loadProjectConfig = async (
  dir = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): Promise<ProjectConfigResult> => {
  const start = env.DEPLI_PROJECT_DIR || dir;
  const path = findProjectConfig(start);
  if (!path) return { config: {}, raw: {}, flows: [], dir: resolve(start) };
  try {
    const module = await import(pathToFileURL(path).href);
    const raw = (module.default ?? module.config ?? {}) as DepliProjectConfig;
    const { config, flow, label, flows, error } = resolveFlow(raw, env.DEPLI_FLOW || undefined);
    return { config, raw, flow, flowLabel: label, flows, dir: dirname(path), path, error };
  } catch (error) {
    return {
      config: {},
      raw: {},
      flows: [],
      dir: dirname(path),
      path,
      error: (error as Error).message,
    };
  }
};

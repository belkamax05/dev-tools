/**
 * envi as a library — the dashboard's resolution, without the dashboard. Nothing here imports
 * React or Ink.
 *
 * ```ts
 * import { config } from '@/dev-tools/envi/index';
 *
 * await config(); // like `dotenv.config()`, with envi's layers: your vars, .env, .env.user,
 *                 // env.config.ts — into process.env, never over what the shell exported
 * ```
 */
import { type Resolution, type ResolveOptions, resolveEnv } from './core/resolve';

export { defineConfig, type EnviProjectConfig } from './config/project';
export type { EnviConfig } from './config/settings';
export {
  formatDotenv,
  readEnvFile,
  removeFromEnvFile,
  setInEnvFile,
} from './core/envFile';
export { evaluate, expandText, parse, parseDotenv } from './core/parse';
export type {
  Layer,
  Resolution,
  ResolvedVar,
  ResolveOptions,
  VarStatus,
} from './core/resolve';
export { formatExport, hookScript } from './core/shell';
export { resolveEnv };

/** What envi would set in `cwd`, as a plain object of just those variables. */
export const loadEnv = async (options: ResolveOptions = {}): Promise<Record<string, string>> => {
  const resolution = await resolveEnv(options);
  return Object.fromEntries(resolution.vars.map((entry) => [entry.key, entry.value]));
};

/**
 * Apply envi's layers to `process.env` (or `options.target`) — `dotenv.config()`. Returns the
 * whole resolution, so a caller can report `missing` or where a value came from.
 */
export const config = async (
  options: ResolveOptions & {
    target?: Record<string, string | undefined>;
  } = {},
): Promise<Resolution> => {
  const target = options.target ?? process.env;
  const resolution = await resolveEnv({ env: target, ...options });
  for (const entry of resolution.vars) {
    if (entry.status === 'new' || entry.status === 'changed') target[entry.key] = entry.value;
  }
  return resolution;
};

export default config;

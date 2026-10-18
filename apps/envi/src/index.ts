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
import { isOpRef } from './core/onePassword';
import { type Resolution, type ResolveOptions, resolveEnv } from './core/resolve';

export { defineConfig, type EnviProjectConfig } from './config/project';
export type { EnviConfig } from './config/settings';
export {
  formatDotenv,
  readEnvFile,
  removeFromEnvFile,
  setInEnvFile,
} from './core/envFile';
export {
  isOpRef,
  OP_PREFIX,
  type OpFailure,
  readOpRef,
  readOpRefs,
} from './core/onePassword';
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

export interface LoadOptions extends ResolveOptions {
  /**
   * Only these variables — a tool that needs two tokens asks for those two, so 1Password is
   * asked for nothing else. Every variable when unset.
   */
  only?: readonly string[];
}

/** `secrets` defaults to what is asked for: `only`, else every variable. */
const withSecrets = (options: LoadOptions): ResolveOptions => ({
  ...options,
  secrets: options.secrets ?? options.only ?? true,
});

const picked = (resolution: Resolution, only?: readonly string[]) =>
  only ? resolution.vars.filter((entry) => only.includes(entry.key)) : resolution.vars;

/**
 * What envi would set in `cwd`, as a plain object of just those variables — `op://` values read
 * from 1Password; one that could not be read is left out (see `Resolution.secretErrors`).
 */
export const loadEnv = async (options: LoadOptions = {}): Promise<Record<string, string>> => {
  const resolution = await resolveEnv(withSecrets(options));
  return Object.fromEntries(
    picked(resolution, options.only)
      .filter((entry) => !isOpRef(entry.value))
      .map((entry) => [entry.key, entry.value]),
  );
};

/**
 * Apply envi's layers to `process.env` (or `options.target`) — `dotenv.config()`, with `op://`
 * values read from 1Password. Returns the whole resolution, so a caller can report `missing`,
 * `secretErrors` or where a value came from.
 *
 * A reference 1Password could not read is not applied: the program sees the variable unset and
 * says so, rather than sending `op://…` as a token.
 */
export const config = async (
  options: LoadOptions & {
    target?: Record<string, string | undefined>;
  } = {},
): Promise<Resolution> => {
  const target = options.target ?? process.env;
  const resolution = await resolveEnv(withSecrets({ env: target, ...options }));
  for (const entry of picked(resolution, options.only)) {
    if (isOpRef(entry.value)) continue;
    //? A resolved reference replaces the shell's copy of that same reference (the hook exports
    //? `op://…` as it is), whatever the status says
    const fromRef = entry.ref !== undefined && target[entry.key] === entry.ref;
    if (entry.status === 'new' || entry.status === 'changed' || fromRef)
      target[entry.key] = entry.value;
  }
  return resolution;
};

export default config;

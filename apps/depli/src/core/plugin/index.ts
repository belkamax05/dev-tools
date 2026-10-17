/**
 * The contract every deploy target implements. depli itself knows nothing about Jenkins or
 * GitHub: it lists the plugins it was given, asks each whether it is ready, and hands it the
 * deploy. A built-in plugin is replaced by registering another with the same `id`.
 */

/** Everything a plugin may read; it never reaches for `process.env` or the cwd on its own. */
export interface DeployContext<Options = Record<string, unknown>> {
  /** The project folder — where `depli.config.ts` was found, else the cwd. */
  cwd: string;
  /** The environment depli runs with (envi's variables applied, under `dfs deploy`). */
  env: Readonly<Record<string, string | undefined>>;
  /** This plugin's entry from `depli.config.ts`'s `targets`. */
  options: Options;
  /** One line of progress, shown in the dashboard or printed by the CLI. */
  log: (line: string) => void;
  /** Report what would happen, change nothing. */
  dryRun: boolean;
}

/** One readiness check, e.g. "token is set". `ok: false` keeps the target from deploying. */
export interface DeployCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface DeployResult {
  ok: boolean;
  message: string;
  /** Where to watch it: a build page, an Actions run. */
  url?: string;
}

export interface DeployPlugin<Options = Record<string, unknown>> {
  /** What `depli.config.ts` and `depli deploy <id>` call it. Registering an id again replaces it. */
  id: string;
  label: string;
  /** East Asian Width *Wide*, no U+FE0F — the same rule as tab icons. */
  icon: string;
  description: string;
  /** Is everything it needs there — never the values themselves, only whether they are set. */
  check: (context: DeployContext<Options>) => Promise<DeployCheck[]>;
  deploy: (context: DeployContext<Options>) => Promise<DeployResult>;
}

/** Typing help for a plugin; returns its argument. */
export const definePlugin = <Options = Record<string, unknown>>(
  plugin: DeployPlugin<Options>,
): DeployPlugin<Options> => plugin;

/** A check on one variable: set or not — the value never leaves the plugin. */
export const envCheck = (env: DeployContext['env'], key: string, label = key): DeployCheck => ({
  label,
  ok: Boolean(env[key]),
  detail: env[key] ? `${key} is set` : `${key} is unset — add it with envi set ${key}=…`,
});

/**
 * The contracts depli is built from. depli itself knows nothing about Jenkins or GitHub: a
 * *provider plugin* knows how to connect to one kind of system (its transports) and which *step
 * kinds* it offers; a project's config lists provider instances and a pipeline of steps. A
 * built-in plugin is replaced by registering another with the same `id`.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** What every plugin call may read; plugins never reach for `process.env` or the cwd. */
export interface PluginContext<Options = Record<string, unknown>> {
  /** The project folder — where `depli.config.ts` was found. */
  cwd: string;
  env: Env;
  /** The provider instance's options from `depli.config.ts`'s `providers`. */
  options: Options;
  /** The provider's connection — which transport passed its probe. Absent during probing. */
  connection?: Connection;
}

// --- connections -----------------------------------------------------------------------------

/** What a transport can do — the UI says which ones a fallback transport lacks. */
export type Capability = 'heads' | 'commits' | 'checks' | 'pulls' | 'runs' | 'jobs' | 'trigger';

export interface ProbeResult {
  ok: boolean;
  /** Reachable but not authorised, misconfigured, offline (VPN)… — one line. */
  detail: string;
  /** Who we are connected as, when the transport can tell. */
  identity?: string;
}

/**
 * One way to reach a provider — an API token, SSH, a CLI's login. A provider lists them in its
 * order of preference; the first whose probe passes is the one used.
 */
export interface Transport<Options = Record<string, unknown>> {
  id: string;
  label: string;
  capabilities: readonly Capability[];
  probe: (context: PluginContext<Options>) => Promise<ProbeResult>;
}

export interface Connection {
  /** The transport in use, or undefined when none passed. */
  transport?: string;
  capabilities: readonly Capability[];
  probes: Array<ProbeResult & { transport: string; label: string }>;
  checkedAt: number;
}

// --- branches --------------------------------------------------------------------------------

export interface BranchHead {
  name: string;
  sha: string;
  /** ISO time of the head commit; absent over transports that only see SHAs. */
  committedAt?: string;
  message?: string;
}

// --- steps -----------------------------------------------------------------------------------

export type StepState =
  /** Up to date with what came before it. */
  | 'done'
  /** Behind what came before it — this is where the next step is recommended. */
  | 'stale'
  | 'running'
  | 'failed'
  /** Never ran for this branch / env. */
  | 'none'
  /** Waiting on a step before it that is not done. */
  | 'blocked'
  /** Its provider is not connected (VPN down, not logged in…). */
  | 'offline'
  /** The job or resource it reads does not exist (e.g. no such env on this server). */
  | 'missing'
  | 'error';

/** What a step hands to the steps after it, so they can compare against it. */
export interface StepRef {
  sha?: string;
  buildNumber?: number;
  version?: string;
  /** Where `version` came from: read from the run's own output, or worked out by a rule. */
  versionSource?: 'log' | 'derived';
  /** When it finished (ms epoch) — the time-based fallback comparison. */
  finishedAt?: number;
}

export interface StepRun {
  id: string;
  label: string;
  state: 'success' | 'failure' | 'running' | 'aborted' | 'queued' | 'other';
  at?: number;
  /** How long it took (or has taken so far) — the history strip draws runs this wide. */
  durationMs?: number;
  url?: string;
  detail?: string;
}

/** A person behind a step. */
export interface StepActor {
  login: string;
  name?: string;
  /** Drawn where the terminal can show pictures (PNG; other formats fall back to initials). */
  avatarUrl?: string;
  /** What they did: `push`, `force_push`, `pr_merge`, `started`… */
  action?: string;
  at?: number;
}

/** A slice of a run's log, from a byte offset — call again with `next` while `more`. */
export interface LogChunk {
  text: string;
  next: number;
  /** The run is still writing to it. */
  more: boolean;
  /** Set when the log cannot be read here (e.g. only as a zip) — say so, and where to look. */
  unavailable?: string;
}

export interface StepStatus {
  state: StepState;
  summary: string;
  ref?: StepRef;
  url?: string;
  /** Recent runs, newest first — PR checks, Actions runs, Jenkins builds. */
  runs?: StepRun[];
  /** Who did it: who pushed the head, who started the build. */
  actor?: StepActor;
  /** Extra lines for the detail pane. */
  notes?: string[];
}

/** One step of a pipeline as the config declares it. `{env}` in strings is the selected env. */
export interface StepConfig {
  id: string;
  label: string;
  /** The provider instance (a key of `providers`). */
  provider: string;
  /** The provider plugin's step kind. */
  kind: string;
  /** Step ids this one compares against and waits for. */
  after?: string[];
  /** Only shown for these envs; every env when unset. */
  envs?: string[];
  [option: string]: unknown;
}

export interface StepInput {
  step: StepConfig;
  branch: string;
  env: string;
  /** The finished statuses of `step.after`, by step id. */
  upstream: Record<string, StepStatus>;
}

/** The request a trigger would send — shown as the dry run, sent only when triggers are on. */
export interface TriggerPlan {
  target: string;
  method: string;
  url: string;
  params: Record<string, string>;
  /**
   * curl's auth arguments with variable *names*, never values — e.g. `-u "$USER:$TOKEN"` — so a
   * copied plan can be run by hand from a shell that has them.
   */
  shellAuth?: string;
  /** Derived values the user should double-check. */
  warnings?: string[];
  /** What the target would refuse — found while planning; the gate will not send it. */
  blockers?: string[];
}

export interface LatestRun {
  state: StepState;
  /** The branch it ran for, when the step records one. */
  branch?: string;
  summary: string;
  ref?: StepRef;
  /** e.g. `FE_NGINX_VERSION → 1.0.x-….1008`. */
  versions?: Record<string, string>;
  at?: number;
  url?: string;
}

export interface StepKind<Options = Record<string, unknown>> {
  status: (context: PluginContext<Options>, input: StepInput) => Promise<StepStatus>;
  /** Build the request without sending it. Absent: the step is observe-only. */
  plan?: (context: PluginContext<Options>, input: StepInput) => Promise<TriggerPlan>;
  /**
   * What the step last did, whatever the branch — "what is on this env right now". Only for
   * steps that act on an env; the environments matrix is built from it.
   */
  latest?: (context: PluginContext<Options>, input: StepInput) => Promise<LatestRun>;
  /** A run's log from `start` (a byte offset; 0 for the whole of it). Read-only. */
  logs?: (
    context: PluginContext<Options>,
    input: StepInput,
    run: StepRun,
    start: number,
  ) => Promise<LogChunk>;
  /** Send a plan. Only ever called through the core's trigger gate. */
  send?: (context: PluginContext<Options>, plan: TriggerPlan) => Promise<{ url?: string }>;
}

export interface ProviderPlugin<Options = Record<string, unknown>> {
  /** What `providers.<name>.plugin` names. Registering an id again replaces it. */
  id: string;
  label: string;
  /** East Asian Width *Wide*, no U+FE0F — the same rule as tab icons. */
  icon: string;
  /** In order of preference; `options.transports` may narrow or reorder them. */
  transports: readonly Transport<Options>[];
  steps: Record<string, StepKind<Options>>;
  /** Branches matching any of the glob patterns, for providers that know branches. */
  branches?: (
    context: PluginContext<Options>,
    connection: Connection,
    patterns: readonly string[],
  ) => Promise<BranchHead[]>;
}

/** Typing help for a plugin; returns its argument. */
export const definePlugin = <Options = Record<string, unknown>>(
  plugin: ProviderPlugin<Options>,
): ProviderPlugin<Options> => plugin;

/** `release-*` style matching — `*` is any run of characters, nothing else is special. */
export const matchesGlob = (name: string, pattern: string): boolean =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name);

/** Matches any plain pattern and no `!pattern`; only exclusions means "everything else". */
export const matchesPatterns = (name: string, patterns: readonly string[]): boolean => {
  const include = patterns.filter((pattern) => !pattern.startsWith('!'));
  const exclude = patterns.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1));
  return (
    (!include.length || include.some((pattern) => matchesGlob(name, pattern))) &&
    !exclude.some((pattern) => matchesGlob(name, pattern))
  );
};

/** `{env}` and `{branch}` in a config string. */
export const fillTemplate = (text: string, input: Pick<StepInput, 'env' | 'branch'>): string =>
  text.replaceAll('{env}', input.env).replaceAll('{branch}', input.branch);

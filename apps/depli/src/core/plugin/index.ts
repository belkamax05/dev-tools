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
  /**
   * The transport's choice the person picked (an SSH key…) — see `ProbeResult.choices`. Set
   * while probing that transport, and afterwards when it is the one in use. Undefined: the
   * transport's own default.
   */
  choice?: string;
  /**
   * Store environment variables the way the project does it — `dfs env set` for dfs, `envi set`
   * otherwise (`envSet` in depli.config.ts) — and apply them to this run, so a probe right after
   * sees them. Resolves to what the command said (where it wrote); rejects with its error.
   */
  setEnv?: (vars: Record<string, string>) => Promise<string>;
}

// --- connections -----------------------------------------------------------------------------

/** What a transport can do — the UI says which ones a fallback transport lacks. */
export type Capability = 'heads' | 'commits' | 'checks' | 'pulls' | 'runs' | 'jobs' | 'trigger';

export type ProbeTone = 'ok' | 'warn' | 'error' | 'info';

/** One "how exactly" line: the remote, the host it resolves to, the key, where the token is from. */
export interface ProbeFact {
  label: string;
  value: string;
  tone?: ProbeTone;
}

export interface GuideLink {
  label: string;
  url: string;
}

/** Why a probe failed, worked out from what it saw, and what to do about it — in order. */
export interface ProbeFix {
  why?: string;
  steps: string[];
  links?: GuideLink[];
}

/**
 * Something a transport can be told to use instead of its default — one SSH key out of several.
 * Listed by the probe, since it is what finds them; picked in the Connections tab.
 */
export interface TransportChoice {
  id: string;
  label: string;
  /** Where it comes from, what is known about it — one line. */
  detail?: string;
  tone?: ProbeTone;
}

export interface ProbeResult {
  ok: boolean;
  /** Reachable but not authorised, misconfigured, offline (VPN)… — one line. */
  detail: string;
  /** Who we are connected as, when the transport can tell. */
  identity?: string;
  /** How it connected, or tried to — so a failure can be read, not guessed at. */
  facts?: ProbeFact[];
  /** Set on a failure the probe recognised. */
  fix?: ProbeFix;
  /** What it could be told to use instead of its default (`PluginContext.choice`). */
  choices?: TransportChoice[];
}

/** How to set a transport up from nothing — static, shown whatever the probe says. */
export interface TransportGuide {
  /** What it is and when to pick it, one or two sentences. */
  summary: string;
  steps: string[];
  links?: GuideLink[];
}

/** Where a guided setup is — what the UI draws while it runs. */
export interface SetupProgress {
  state: 'running' | 'waiting' | 'done' | 'failed';
  /** One line: what is happening, or what went wrong. */
  message: string;
  /** A one-time code to type on `url`'s page. */
  code?: string;
  url?: string;
}

/** One value a setup asks for before it starts — a user id, a token. */
export interface SetupInput<Options = Record<string, unknown>> {
  id: string;
  /** The question, e.g. "Jenkins user id". */
  label: string;
  /** Typed as dots (Tab shows it) — for tokens. */
  secret?: boolean;
  /** What to start the answer from — the value in use now, say. */
  initial?: (context: PluginContext<Options>) => string | undefined;
}

/**
 * A setup the app runs for the person — a CLI's login flow, storing a token — instead of telling
 * them to run something in a shell. Started from the Connections tab; the transport is probed
 * again once it is done.
 */
export interface TransportSetup<Options = Record<string, unknown>> {
  /** The button: "Sign in with the GitHub CLI". */
  label: string;
  /** One sentence: what it will do. */
  detail: string;
  /** What to do — before it starts, or on the page it opened while it waits. */
  steps: string[];
  /** Pages the steps refer to — where a token is made. */
  links?: (context: PluginContext<Options>) => GuideLink[];
  /** Asked for in turn when it is started, then handed to `start` by id. */
  inputs?: SetupInput<Options>[];
  /** Why it cannot run here (the CLI is not installed…), with what to do; undefined when it can. */
  unavailable?: (context: PluginContext<Options>) => Promise<string | undefined>;
  start: (
    context: PluginContext<Options>,
    onProgress: (progress: SetupProgress) => void,
    values: Record<string, string>,
  ) => { cancel: () => void };
}

/**
 * One way to reach a provider — an API token, SSH, a CLI's login. A provider lists them in its
 * order of preference; the first whose probe passes is the one used, unless one is pinned.
 */
export interface Transport<Options = Record<string, unknown>> {
  id: string;
  label: string;
  capabilities: readonly Capability[];
  probe: (context: PluginContext<Options>) => Promise<ProbeResult>;
  guide?: TransportGuide;
  /** The way to use when it can be — the others are fallbacks that do less. */
  recommended?: boolean;
  setup?: TransportSetup<Options>;
  /** Probed and reported, never used — a slot for a transport not built yet. */
  planned?: boolean;
  /** What a choice is called — "SSH key". Set when the probe lists choices. */
  choiceLabel?: string;
}

/** What the person picked for one provider — remembered per project. */
export interface ConnectionPreference {
  /** Always this transport, even when it fails; the first that works when unset. */
  transport?: string;
  /** Per transport id, the choice to use (`TransportChoice.id`). */
  choices?: Record<string, string>;
}

export interface Connection {
  /** The transport in use, or undefined when none passed. */
  transport?: string;
  /** The choice the transport in use was probed with, when one was picked. */
  choice?: string;
  /** The transport was pinned rather than picked as the first that works. */
  pinned?: string;
  capabilities: readonly Capability[];
  probes: Array<
    ProbeResult & { transport: string; label: string; choice?: string; disabled?: boolean }
  >;
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
  branch?: string;
  id: string;
  label: string;
  state: 'success' | 'failure' | 'running' | 'aborted' | 'queued' | 'other';
  at?: number;
  /** How long it took (or has taken so far) — the history strip draws runs this wide. */
  durationMs?: number;
  url?: string;
  detail?: string;
}

/** Provider-neutral stage timings for one run and a historical comparison. */
export interface StageTiming {
  id: string;
  label: string;
  state: 'pending' | 'running' | 'paused' | 'success' | 'failure' | 'aborted' | 'skipped' | 'other';
  durationMs?: number;
  averageMs?: number;
  samples: number;
}
export interface RunTimings {
  state?: StepRun['state'];
  elapsedMs?: number;
  estimatedTotalMs?: number;
  stages: StageTiming[];
  /** Build ids used for comparison, from the same job, earlier successful builds only. */
  previousRuns: string[];
  more: boolean;
  unavailable?: string;
}

/** A value a step produced, which later steps use. */
export interface StepOutput {
  label: string;
  value: string;
  /** Where it came from, e.g. "from its log" or "derived from the build number". */
  note?: string;
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
  activeRuns?: StepRun[];
  state: StepState;
  summary: string;
  ref?: StepRef;
  url?: string;
  /** Recent runs, newest first — PR checks, Actions runs, Jenkins builds. */
  runs?: StepRun[];
  /** Who did it: who pushed the head, who started the build. */
  actor?: StepActor;
  /** What it produced for the steps after it — an image tag, an artifact — highlighted in the detail. */
  outputs?: StepOutput[];
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
  /**
   * Shown under the reasons when the step cannot be triggered: where the thing that blocks it is
   * defined, who to ask — project knowledge, so it lives in the project's config.
   */
  blockedHelp?: string;
  /**
   * Run on a linked branch (`linkedBranches` in the config — another flow's pick) instead of the
   * one picked here: e.g. the backend flow reading the frontend's builds for the FE branch.
   */
  branchFrom?: string;
  /** Shown and compared, never triggered from this pipeline — another flow builds it. */
  observeOnly?: boolean;
  [option: string]: unknown;
}

export interface StepInput {
  step: StepConfig;
  /** The step's branch: the one picked, or its `branchFrom` linked branch. */
  branch: string;
  env: string;
  /** The finished statuses of `step.after`, by step id. */
  upstream: Record<string, StepStatus>;
  /** Every linked branch by id (`linkedBranches`), for params that send one — e.g. `fe`. */
  branches?: Record<string, string>;
}

/**
 * A change on the target that would make it accept the request — e.g. adding a branch to a job's
 * choice list. It edits shared configuration, so it is applied only through the core's gate, after
 * an explicit confirmation (the UI's Apply button).
 */
export interface PlanFix {
  id: string;
  label: string;
  /** What exactly changes, for whom, and for how long. */
  detail: string;
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
  /**
   * Where each parameter's value comes from: an earlier step's id (it produced the value), or
   * `branch`. Parameters not listed are the config's own values.
   */
  sources?: Record<string, string>;
  /** What the target would refuse — found while planning; the gate will not send it. */
  blockers?: string[];
  /** Changes on the target that would lift a blocker — each one edits something shared. */
  fixes?: PlanFix[];
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

/** One run in a job's history: the run, every parameter it was given, and who started it. */
export interface HistoryRun extends StepRun {
  params?: Record<string, string>;
  actor?: StepActor;
  /** The commit it built (a build's checkout), or is (a branch's commit). */
  sha?: string;
}

/**
 * One job a step reads — its own, or another that does the same thing (Jenkins'
 * `alsoDeployedBy`) — with its recent runs, newest first, whatever branch they were for.
 */
export interface JobHistory {
  /** The job's name on the target, templates filled (`deploy_frontend_only_ci`). */
  job: string;
  url?: string;
  /** How it relates to the step; undefined for the step's own job. */
  relation?: string;
  runs: HistoryRun[];
  /** The job does not exist on the target. */
  missing?: boolean;
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
  /**
   * Every job the step reads and their recent runs, whatever the branch — the
   * Environments view. Read-only; absent: the step has no history to show.
   */
  history?: (context: PluginContext<Options>, input: StepInput) => Promise<JobHistory[]>;
  /**
   * `history` depends on `input.branch` (a branch's commits) rather than listing every branch's
   * runs: read once per branch an env runs.
   */
  historyByBranch?: boolean;
  /** A run's log from `start` (a byte offset; 0 for the whole of it). Read-only. */
  logs?: (
    context: PluginContext<Options>,
    input: StepInput,
    run: StepRun,
    start: number,
  ) => Promise<LogChunk>;
  activeRuns?: (context: PluginContext<Options>, input: StepInput) => Promise<StepRun[]>;
  timings?: (
    context: PluginContext<Options>,
    input: StepInput,
    run: StepRun,
  ) => Promise<RunTimings>;
  /** Apply one of a plan's fixes. Only ever called through the core's gate. Returns what changed. */
  fix?: (context: PluginContext<Options>, plan: TriggerPlan, fixId: string) => Promise<string>;
  /** Send a plan. Only ever called through the core's trigger gate. */
  send?: (context: PluginContext<Options>, plan: TriggerPlan) => Promise<{ url?: string }>;
  /**
   * Stop (abort) a running run. Only ever called through the core's stop gate, which has made
   * sure it is running and confirmed. Returns what was done.
   */
  stop?: (context: PluginContext<Options>, input: StepInput, run: StepRun) => Promise<string>;
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
  /**
   * Branches matching any of the glob patterns, for providers that know branches. `source` is
   * the config's `branches.source` — where this provider reads them (Jenkins: a job's choice list).
   */
  branches?: (
    context: PluginContext<Options>,
    connection: Connection,
    patterns: readonly string[],
    source?: Record<string, unknown>,
  ) => Promise<BranchHead[]>;
  /**
   * A commit's page, for providers that host the repository — built from the options alone, no
   * request. Undefined when the provider cannot say where its pages are.
   */
  commitUrl?: (options: Options, sha: string) => string | undefined;
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

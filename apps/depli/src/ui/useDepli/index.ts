import { useCallback, useEffect, useRef, useState } from 'react';

import { type AutoDecision, type AutoTrigger, autoKey, decideAuto } from '../../core/auto';
import { currentBranch, pickRecentBranches } from '../../core/branch';
import { type ChainStep, evaluateChain } from '../../core/chain';
import { connectAll, probeChoice } from '../../core/connection';
import { type History, readHistory } from '../../core/history';
import { type EnvRow, evaluateEnvs } from '../../core/matrix';
import { readLog } from '../../core/logs';
import {
  type BranchHead,
  fillTemplate,
  type Connection,
  type ConnectionPreference,
  type LogChunk,
  type RunTimings,
  type PluginContext,
  type SetupProgress,
  matchesPatterns,
  type StepRun,
} from '../../core/plugin';
import { type Session, saveSession } from '../../core/session';
import { contextFor, inputFor } from '../../core/registry';
import {
  applyFix,
  type PlannedTrigger,
  planTrigger,
  sendTrigger,
  stopRun,
} from '../../core/trigger';

/** How often the checkout's branch is re-read — cheap, local, so often. */
const BRANCH_POLL_MS = 3_000;
/**
 * How long a step an auto trigger just sent still counts as on its way: a queued build is not
 * `running` yet, and the steps armed behind it must keep waiting rather than be dropped.
 */
const LAUNCH_GRACE_MS = 3 * 60_000;

type Tone = 'ok' | 'warn' | 'error' | 'info';

export interface DepliData {
  branch?: string;
  current?: string;
  targetEnv: string;
  connections: Record<string, Connection>;
  chain: ChainStep[];
  /** True while the chain is being (re)evaluated; steps fill in as they finish. */
  loading: boolean;
  /** The provider's branches to list: `branches.recent` (or `watch`), or all — newest first. */
  branches?: BranchHead[];
  allBranches: boolean;
  /** What every env runs now; undefined until asked for, or while being read. */
  envs?: EnvRow[];
  /** Every job and its recent runs, per env — undefined until asked for; kept while re-read. */
  history?: History;
  historyLoading: boolean;
  selectBranch: (name: string) => void;
  /** Back to the checkout's branch, dropping the pick. */
  resetBranch: () => void;
  setEnv: (env: string) => void;
  refresh: () => void;
  /** Probe the connections now, not on the next poll. */
  reprobe: () => void;
  /** What was picked per provider in the Connections tab. */
  preferences: Record<string, ConnectionPreference>;
  /** Pin a transport, pick a choice — remembered for the project, then probed at once. */
  setPreference: (provider: string, preference: ConnectionPreference) => void;
  /** The guided setup running (or last run), by `provider:transport` — one at a time. */
  setup?: { key: string; progress: SetupProgress };
  /**
   * Start a transport's guided setup (gh auth login, storing a Jenkins token…) with the answers to
   * its `inputs`; probes again once it is done.
   */
  startSetup: (provider: string, transport: string, values?: Record<string, string>) => void;
  /** The context a setup runs with — for its `inputs`' initial values. */
  setupContext: (provider: string) => PluginContext<any> | undefined;
  cancelSetup: () => void;
  /** Why a transport's setup cannot run here, or undefined when it can. */
  setupUnavailable: (provider: string, transport: string) => Promise<string | undefined>;
  /** Probe one transport with one choice (an SSH key) — a test; nothing is changed or kept. */
  probeChoice: (
    provider: string,
    transport: string,
    choice: string | undefined,
  ) => Promise<Connection['probes'][number]>;
  loadBranches: (all: boolean) => void;
  loadEnvs: () => void;
  /** Read `history` (again) — the Environments window asks for it. */
  loadHistory: () => void;
  plan: (stepId: string) => Promise<PlannedTrigger>;
  /** Whether a step can be triggered at all — its plugin plans it; observe-only steps do not. */
  triggerable: (entry: ChainStep) => boolean;
  providerOf: (entry: ChainStep) => { id: string; label: string };
  /** A run's log from a byte offset — read-only. */
  readLog: (entry: ChainStep, run: StepRun, start: number) => Promise<LogChunk>;
  otherRunsExpanded: Record<string, boolean>;
  setOtherRunExpanded: (key: string, expanded: boolean) => void;
  hasActiveRuns: (entry: ChainStep) => boolean;
  readActiveRuns: (entry: ChainStep) => Promise<StepRun[]>;
  timingsExpanded: boolean;
  setTimingsExpanded: (expanded: boolean) => void;
  hasTimings: (entry: ChainStep) => boolean;
  readTimings: (entry: ChainStep, run: StepRun) => Promise<RunTimings>;
  /** A plan's fix (an edit on the target), through the core's gate — call it once the user confirmed. */
  applyFix: (planned: PlannedTrigger, fixId: string) => Promise<string>;
  /** Through the core's gate — refused unless triggers are on and the confirmation holds. */
  send: (planned: PlannedTrigger, protectedEnv?: string) => Promise<{ url?: string }>;
  /** Whether the step's plugin can stop its runs (and the connection may write). */
  stoppable: (entry: ChainStep) => boolean;
  /** Stop a running run, through the core's gate — call it once the user confirmed. */
  stop: (entry: ChainStep, run: StepRun, protectedEnv?: string) => Promise<string>;
  /** Armed one-shot triggers, in the order they were armed — in memory, gone on restart. */
  autos: AutoTrigger[];
  /** What each armed trigger would do now, by `autoKey` — only for the branch and env shown. */
  autoStatus: Record<string, AutoDecision>;
  /** The step ids armed for the branch and env shown. */
  armedIds: ReadonlySet<string>;
  /** Arm a step for the branch and env shown; `protectedEnv` is the typed confirmation. */
  arm: (entry: ChainStep, protectedEnv?: string) => void;
  disarm: (key: string) => void;
}

/** Which transport each provider uses — the chain is re-read when this, not a timestamp, moves. */
const transportsKey = (connections: Record<string, Connection>) =>
  Object.entries(connections)
    .map(([name, connection]) => `${name}=${connection.transport ?? '-'}`)
    .join(',');

/**
 * Everything the dashboard shows, kept live: connections re-probed on the config's interval, the
 * checkout's branch re-read every few seconds (a switch drops the pick and preselects the new
 * branch), the chain re-read when its inputs change — and on each poll while a step is running,
 * so a build in progress is followed without pressing anything.
 */
export const useDepli = (
  session: Session,
  notify: (text: string, tone?: Tone) => void,
): DepliData => {
  const { project, env } = session;
  const [branch, setBranch] = useState(session.branch);
  const [current, setCurrent] = useState(session.current);
  const [otherRunsExpanded, setOtherRunsExpanded] = useState(session.state.otherRunsExpanded ?? {});
  const [timingsExpanded, setTimingsExpanded] = useState(session.state.timingsExpanded === true);
  const [targetEnv, setTargetEnv] = useState(session.targetEnv);
  const [connections, setConnections] = useState<Record<string, Connection>>({});
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [allHeads, setAllHeads] = useState<BranchHead[]>();
  const [allBranches, setAllBranches] = useState(false);
  const [envs, setEnvs] = useState<EnvRow[]>();
  const envsRef = useRef(envs);
  envsRef.current = envs;
  const [history, setHistory] = useState<History>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [probeTick, setProbeTick] = useState(0);
  const [setup, setSetup] = useState<{ key: string; progress: SetupProgress }>();
  const setupRun = useRef<{ cancel: () => void }>(undefined);
  //? A login left waiting when the app quits is cancelled with it
  useEffect(() => () => setupRun.current?.cancel(), []);
  //? Auto triggers: plain React state, never saved — a restart forgets every one
  const [autos, setAutos] = useState<AutoTrigger[]>([]);
  const autosRef = useRef(autos);
  autosRef.current = autos;
  //? Steps an auto trigger sent, by autoKey, and when — still "on their way" for a while
  const launched = useRef(new Map<string, number>());
  const firing = useRef(new Set<string>());
  //? Which branch and env `chain` was fully evaluated for — never decide on a chain in between
  const [evaluated, setEvaluated] = useState<{ branch: string; env: string }>();
  const state = useRef(session.state);
  const currentRef = useRef(session.current);
  const connectionsRef = useRef(connections);
  const chainRef = useRef(chain);
  chainRef.current = chain;
  const key = transportsKey(connections);

  const persist = useCallback(() => {
    session.state = state.current;
    saveSession(session).catch((error: Error) =>
      notify(`Could not save branch and environment: ${error.message}`, 'warn'),
    );
  }, [session, notify]);

  //? Connections: now, then on the poll interval
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick and probeTick are manual
  useEffect(() => {
    let live = true;
    const probe = (refresh = false) =>
      connectAll(project, env, state.current.connections).then((next) => {
        if (!live) return;
        connectionsRef.current = next;
        setConnections(next);
        //? Re-read while something runs — or an auto trigger waits for it to
        if (
          refresh ||
          chainRef.current.some((entry) => entry.status.state === 'running') ||
          autosRef.current.length
        )
          setTick((t) => t + 1);
      });
    // Credentials can change while the transport remains `api`: re-read failed steps too.
    probe(true);
    const seconds = project.config.pollSeconds ?? 30;
    const timer = seconds > 0 ? setInterval(() => probe(), seconds * 1000) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [project, env, probeTick]);

  //? The checkout's branch, for the header and [B] only — switching it never changes the pick
  useEffect(() => {
    const path = project.config.repo?.path;
    if (!path) return;
    const timer = setInterval(async () => {
      const now = await currentBranch(path);
      if (now === currentRef.current) return;
      currentRef.current = now;
      setCurrent(now);
    }, BRANCH_POLL_MS);
    return () => clearInterval(timer);
  }, [project]);

  //? The chain, step by step as each one answers
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for connections; tick is manual
  useEffect(() => {
    if (!branch || !key) return;
    let live = true;
    setLoading(true);
    setEvaluated(undefined);
    evaluateChain(project, connectionsRef.current, env, branch, targetEnv, (partial) => {
      if (live) setChain(partial);
    }).then((done) => {
      if (!live) return;
      setChain(done);
      setEvaluated({ branch, env: targetEnv });
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [project, env, branch, targetEnv, key, tick]);

  const branchProvider = () => {
    const name = project.config.branches?.provider;
    return project.providers.find((entry) => (name ? entry.name === name : entry.plugin.branches));
  };

  //? Every branch once per connection; the watch list is filtered from it locally
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for connections
  const loadBranches = useCallback(
    (all: boolean) => {
      setAllBranches(all);
      if (allHeads || !key) return;
      const provider = branchProvider();
      const connection = provider && connectionsRef.current[provider.name];
      if (!provider?.plugin.branches || !connection?.transport) {
        setAllHeads([]);
        return;
      }
      provider.plugin
        .branches(
          contextFor(project, provider, env, connection),
          connection,
          [],
          project.config.branches?.source,
        )
        .then((heads) =>
          setAllHeads(
            [...heads].sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? '')),
          ),
        )
        .catch((error: Error) => {
          setAllHeads([]);
          notify(error.message, 'error');
        });
    },
    [project, env, key, allHeads, notify],
  );

  const loadEnvs = useCallback(() => {
    if (!branch || !key) return;
    setEnvs(undefined);
    evaluateEnvs(project, connectionsRef.current, env, branch)
      .then(setEnvs)
      .catch((error: Error) => notify(error.message, 'error'));
  }, [project, env, branch, key, notify]);

  const loadHistory = useCallback(() => {
    if (!key) return;
    setHistoryLoading(true);
    //? The branches the envs run (when read) get their commits read too
    const running = (envsRef.current ?? []).flatMap((row) =>
      row.cells.flatMap((cell) => (cell.latest.branch ? [cell.latest.branch] : [])),
    );
    readHistory(project, connectionsRef.current, env, branch ?? '', targetEnv, running)
      .then(setHistory)
      .catch((error: Error) => notify(error.message, 'error'))
      .finally(() => setHistoryLoading(false));
  }, [project, env, branch, targetEnv, key, notify]);

  //? Auto triggers for the branch and env shown, against the chain fully read for them
  const shown = evaluated && evaluated.branch === branch && evaluated.env === targetEnv;
  const here = (auto: AutoTrigger) => auto.branch === branch && auto.env === targetEnv;
  const now = Date.now();
  const armedIds = new Set([
    ...autos.filter(here).map((auto) => auto.stepId),
    ...[...launched.current]
      .filter(
        ([launchKey, at]) =>
          now - at < LAUNCH_GRACE_MS &&
          launchKey.startsWith(autoKey({ branch: branch ?? '', env: targetEnv, stepId: '' })),
      )
      .map(([launchKey]) => launchKey.split('\u0000')[2] as string),
  ]);
  const autoStatus: Record<string, AutoDecision> = shown
    ? Object.fromEntries(
        autos.filter(here).map((auto) => [autoKey(auto), decideAuto(chain, auto.stepId, armedIds)]),
      )
    : {};

  //? Fire what is due, drop what can no longer happen — each exactly once
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fully read chain is the trigger
  useEffect(() => {
    if (!shown) return;
    for (const auto of autosRef.current.filter(here)) {
      const autoId = autoKey(auto);
      const decision = autoStatus[autoId];
      if (!decision || decision.kind === 'wait' || firing.current.has(autoId)) continue;
      //? Off the list before anything is sent: a second pass can never send it again
      setAutos((was) => was.filter((item) => autoKey(item) !== autoId));
      if (decision.kind === 'drop') {
        notify(`Auto trigger for ${auto.label} dropped: ${decision.reason}`, 'warn');
        continue;
      }
      firing.current.add(autoId);
      launched.current.set(autoId, Date.now());
      planTrigger(project, connectionsRef.current, env, chain, auto.stepId, auto.branch, auto.env)
        .then((planned) =>
          sendTrigger(project, connectionsRef.current, env, planned, {
            confirmed: true,
            protectedEnv: auto.protectedEnv,
            targetEnv: auto.env,
          }).then((sent) => {
            notify(
              `Auto-triggered ${planned.plan.target}${sent.url ? ` — ${sent.url}` : ''}`,
              'ok',
            );
            setTick((value) => value + 1);
          }),
        )
        .catch((error: Error) => {
          launched.current.delete(autoId);
          notify(`Auto trigger for ${auto.label} not sent: ${error.message}`, 'error');
        })
        .finally(() => firing.current.delete(autoId));
    }
  }, [chain, shown]);

  const watch = project.config.branches?.watch ?? [];
  const recent = project.config.branches?.recent;
  const picked =
    allHeads &&
    (recent
      ? pickRecentBranches(allHeads, recent)
      : allHeads.filter((head) => matchesPatterns(head.name, watch)));
  //? The branch shown stays listed even when the rule would leave it out
  const shownHead = allHeads?.find((head) => head.name === branch);
  const branches =
    allHeads &&
    (allBranches
      ? allHeads
      : picked && shownHead && !picked.includes(shownHead)
        ? [shownHead, ...picked]
        : picked);

  //? Nothing picked yet: read the provider's branches and start on the newest of the list
  // biome-ignore lint/correctness/useExhaustiveDependencies: once connections land
  useEffect(() => {
    if (branch || !key) return;
    if (!allHeads) loadBranches(false);
    else if (picked?.[0]) setBranch(picked[0].name);
  }, [branch, key, allHeads]);

  return {
    branch,
    current,
    targetEnv,
    connections,
    chain,
    loading,
    branches,
    allBranches,
    envs,
    history,
    historyLoading,
    selectBranch: (name) => {
      state.current = { ...state.current, selected: name, pickedWhileOn: currentRef.current };
      persist();
      setBranch(name);
    },
    resetBranch: () => {
      state.current = {
        ...state.current,
        selected: currentRef.current,
        pickedWhileOn: currentRef.current,
      };
      persist();
      setBranch(currentRef.current);
    },
    setEnv: (next) => {
      state.current = { ...state.current, env: next };
      persist();
      setTargetEnv(next);
    },
    refresh: () => {
      setAllHeads(undefined);
      setTick((value) => value + 1);
      if (envs) loadEnvs();
      if (history) loadHistory();
    },
    reprobe: () => setProbeTick((value) => value + 1),
    preferences: state.current.connections ?? {},
    setPreference: (provider, preference) => {
      state.current = {
        ...state.current,
        connections: { ...state.current.connections, [provider]: preference },
      };
      persist();
      setProbeTick((value) => value + 1);
    },
    setup,
    startSetup: (name, transportId, values = {}) => {
      const provider = project.providers.find((entry) => entry.name === name);
      const transport = provider?.transports.find((entry) => entry.id === transportId);
      if (!provider || !transport?.setup) return;
      setupRun.current?.cancel();
      const key = `${name}:${transportId}`;
      setupRun.current = transport.setup.start(
        contextFor(project, provider, env),
        (progress) => {
          setSetup({ key, progress });
          if (progress.state === 'done') {
            setupRun.current = undefined;
            setProbeTick((value) => value + 1);
            //? Once more shortly after: GitHub can take a moment to honour a token just issued
            setTimeout(() => setProbeTick((value) => value + 1), 3_000);
          } else if (progress.state === 'failed') {
            setupRun.current = undefined;
            setProbeTick((value) => value + 1);
          }
        },
        values,
      );
    },
    setupContext: (name) => {
      const provider = project.providers.find((entry) => entry.name === name);
      return provider && contextFor(project, provider, env);
    },
    cancelSetup: () => {
      setupRun.current?.cancel();
      setupRun.current = undefined;
    },
    setupUnavailable: async (name, transportId) => {
      const provider = project.providers.find((entry) => entry.name === name);
      const transport = provider?.transports.find((entry) => entry.id === transportId);
      if (!provider || !transport?.setup?.unavailable) return undefined;
      return transport.setup.unavailable(contextFor(project, provider, env));
    },
    probeChoice: (name, transport, choice) => {
      const provider = project.providers.find((entry) => entry.name === name);
      if (!provider) return Promise.reject(new Error(`no provider ${name}`));
      return probeChoice(project, provider, env, transport, choice);
    },
    loadBranches,
    loadEnvs,
    loadHistory,
    plan: (stepId) =>
      planTrigger(project, connectionsRef.current, env, chain, stepId, branch ?? '', targetEnv),
    providerOf: (entry) => {
      const plugin = project.providers.find((item) => item.name === entry.step.provider)?.plugin;
      return { id: plugin?.id ?? entry.step.provider, label: entry.step.provider };
    },
    triggerable: (entry) =>
      !entry.step.observeOnly &&
      Boolean(
        project.providers.find((item) => item.name === entry.step.provider)?.plugin.steps[
          entry.step.kind
        ]?.plan,
      ),
    otherRunsExpanded,
    setOtherRunExpanded: (key, expanded) => {
      const next = { ...state.current.otherRunsExpanded, [key]: expanded };
      state.current = { ...state.current, otherRunsExpanded: next };
      persist();
      setOtherRunsExpanded(next);
    },
    hasActiveRuns: (entry) =>
      Boolean(
        project.providers.find((provider) => provider.name === entry.step.provider)?.plugin.steps[
          entry.step.kind
        ]?.activeRuns,
      ),
    readActiveRuns: (entry) => {
      const provider = project.providers.find((item) => item.name === entry.step.provider);
      const kind = provider?.plugin.steps[entry.step.kind];
      if (!provider || !kind?.activeRuns) return Promise.resolve([]);
      return kind.activeRuns(
        contextFor(project, provider, env, connectionsRef.current[provider.name]),
        inputFor(project, entry.step, branch ?? '', targetEnv),
      );
    },
    timingsExpanded,
    setTimingsExpanded: (expanded) => {
      state.current = { ...state.current, timingsExpanded: expanded };
      persist();
      setTimingsExpanded(expanded);
    },
    hasTimings: (entry) =>
      Boolean(
        project.providers.find((provider) => provider.name === entry.step.provider)?.plugin.steps[
          entry.step.kind
        ]?.timings,
      ),
    readTimings: (entry, run) => {
      const provider = project.providers.find((item) => item.name === entry.step.provider);
      const kind = provider?.plugin.steps[entry.step.kind];
      if (!provider || !kind?.timings)
        return Promise.resolve({ stages: [], previousRuns: [], more: false });
      return kind.timings(
        contextFor(project, provider, env, connectionsRef.current[provider.name]),
        inputFor(project, entry.step, branch ?? '', targetEnv),
        run,
      );
    },
    readLog: (entry, run, start) =>
      readLog(project, connectionsRef.current, env, entry, run, branch ?? '', targetEnv, start),
    applyFix: (planned, fixId) =>
      applyFix(project, connectionsRef.current, env, planned, fixId, true),
    send: (planned, protectedEnv) =>
      sendTrigger(project, connectionsRef.current, env, planned, {
        confirmed: true,
        protectedEnv,
        targetEnv,
      }),
    stoppable: (entry) => {
      const provider = project.providers.find((item) => item.name === entry.step.provider);
      return Boolean(
        provider?.plugin.steps[entry.step.kind]?.stop &&
          connectionsRef.current[provider.name]?.capabilities.includes('trigger'),
      );
    },
    stop: (entry, run, protectedEnv) =>
      stopRun(
        project,
        connectionsRef.current,
        env,
        entry,
        run,
        { branch: branch ?? '', targetEnv },
        { confirmed: true, protectedEnv },
      ),
    autos,
    autoStatus,
    armedIds,
    arm: (entry, protectedEnv) => {
      if (!branch) return;
      const auto: AutoTrigger = {
        stepId: entry.step.id,
        label: fillTemplate(entry.step.label, { env: targetEnv, branch }),
        branch,
        env: targetEnv,
        armedAt: Date.now(),
        protectedEnv,
      };
      setAutos((was) =>
        was.some((item) => autoKey(item) === autoKey(auto)) ? was : [...was, auto],
      );
    },
    disarm: (key) => setAutos((was) => was.filter((item) => autoKey(item) !== key)),
  };
};

export default useDepli;

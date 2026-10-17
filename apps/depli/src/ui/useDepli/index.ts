import { useCallback, useEffect, useRef, useState } from 'react';

import { currentBranch, localBranches, resolveSelection } from '../../core/branch';
import { type ChainStep, evaluateChain } from '../../core/chain';
import { connectAll } from '../../core/connection';
import { type EnvRow, evaluateEnvs } from '../../core/matrix';
import { readLog } from '../../core/logs';
import {
  type BranchHead,
  type Connection,
  type LogChunk,
  type RunTimings,
  matchesPatterns,
  type StepRun,
} from '../../core/plugin';
import { type Session, saveSession } from '../../core/session';
import { contextFor } from '../../core/registry';
import { applyFix, type PlannedTrigger, planTrigger, sendTrigger } from '../../core/trigger';

/** How often the checkout's branch is re-read — cheap, local, so often. */
const BRANCH_POLL_MS = 3_000;

type Tone = 'ok' | 'warn' | 'error' | 'info';

export interface DepliData {
  branch?: string;
  current?: string;
  targetEnv: string;
  connections: Record<string, Connection>;
  chain: ChainStep[];
  /** True while the chain is being (re)evaluated; steps fill in as they finish. */
  loading: boolean;
  branches?: BranchHead[];
  /** The checkout's local branches, newest first — undefined while being read. */
  localBranches?: BranchHead[];
  /** Every branch the provider has, by name — what tells a pushed branch from a local-only one. */
  pushedBranches?: ReadonlyMap<string, BranchHead>;
  allBranches: boolean;
  /** What every env runs now; undefined until asked for, or while being read. */
  envs?: EnvRow[];
  selectBranch: (name: string) => void;
  /** Back to the checkout's branch, dropping the pick. */
  resetBranch: () => void;
  setEnv: (env: string) => void;
  refresh: () => void;
  /** Probe the connections now, not on the next poll. */
  reprobe: () => void;
  loadBranches: (all: boolean) => void;
  loadEnvs: () => void;
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
  const [localHeads, setLocalHeads] = useState<BranchHead[]>();
  const [allBranches, setAllBranches] = useState(false);
  const [envs, setEnvs] = useState<EnvRow[]>();
  const [tick, setTick] = useState(0);
  const [probeTick, setProbeTick] = useState(0);
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
    const probe = () =>
      connectAll(project, env).then((next) => {
        if (!live) return;
        connectionsRef.current = next;
        setConnections(next);
        if (chainRef.current.some((entry) => entry.status.state === 'running'))
          setTick((t) => t + 1);
      });
    probe();
    const seconds = project.config.pollSeconds ?? 30;
    const timer = seconds > 0 ? setInterval(probe, seconds * 1000) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [project, env, probeTick]);

  //? The checkout's branch: a switch there invalidates the pick made on the old one
  useEffect(() => {
    const path = project.config.repo?.path;
    if (!path) return;
    const timer = setInterval(async () => {
      const now = await currentBranch(path);
      if (now === currentRef.current) return;
      currentRef.current = now;
      setCurrent(now);
      const resolved = resolveSelection(state.current, now);
      state.current = { ...state.current, ...resolved.selection };
      persist();
      setBranch(resolved.branch);
      if (resolved.reset) notify(`Checkout switched to ${now} — now showing it`, 'info');
    }, BRANCH_POLL_MS);
    return () => clearInterval(timer);
  }, [project, persist, notify]);

  //? The chain, step by step as each one answers
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for connections; tick is manual
  useEffect(() => {
    if (!branch || !key) return;
    let live = true;
    setLoading(true);
    evaluateChain(project, connectionsRef.current, env, branch, targetEnv, (partial) => {
      if (live) setChain(partial);
    }).then((done) => {
      if (!live) return;
      setChain(done);
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
      //? The checkout's own branches: cheap and local, read every time the list is asked for
      const repoPath = project.config.repo?.path;
      if (repoPath) localBranches(repoPath).then((heads) => setLocalHeads(heads ?? []));
      else setLocalHeads([]);
      if (allHeads || !key) return;
      const provider = branchProvider();
      const connection = provider && connectionsRef.current[provider.name];
      if (!provider?.plugin.branches || !connection?.transport) {
        setAllHeads([]);
        return;
      }
      provider.plugin
        .branches({ cwd: project.dir, env, options: provider.options, connection }, connection, [])
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

  const watch = project.config.branches?.watch ?? [];
  const branches =
    allHeads &&
    (allBranches
      ? allHeads
      : allHeads.filter((head) => head.name === branch || matchesPatterns(head.name, watch)));

  return {
    branch,
    current,
    targetEnv,
    connections,
    chain,
    loading,
    branches,
    localBranches: localHeads,
    pushedBranches: allHeads && new Map(allHeads.map((head) => [head.name, head])),
    allBranches,
    envs,
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
    },
    reprobe: () => setProbeTick((value) => value + 1),
    loadBranches,
    loadEnvs,
    plan: (stepId) =>
      planTrigger(project, connectionsRef.current, env, chain, stepId, branch ?? '', targetEnv),
    providerOf: (entry) => {
      const plugin = project.providers.find((item) => item.name === entry.step.provider)?.plugin;
      return { id: plugin?.id ?? entry.step.provider, label: entry.step.provider };
    },
    triggerable: (entry) =>
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
        { step: entry.step, branch: branch ?? '', env: targetEnv, upstream: {} },
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
        { step: entry.step, branch: branch ?? '', env: targetEnv, upstream: {} },
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
  };
};

export default useDepli;

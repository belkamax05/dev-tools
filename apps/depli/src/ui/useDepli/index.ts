import { useCallback, useEffect, useRef, useState } from 'react';

import { currentBranch, resolveSelection } from '../../core/branch';
import { type ChainStep, evaluateChain } from '../../core/chain';
import { connectAll } from '../../core/connection';
import { type EnvRow, evaluateEnvs } from '../../core/matrix';
import { readLog } from '../../core/logs';
import {
  type BranchHead,
  type Connection,
  type LogChunk,
  matchesPatterns,
  type StepRun,
} from '../../core/plugin';
import { type Session, saveSession } from '../../core/session';
import { type PlannedTrigger, planTrigger, sendTrigger } from '../../core/trigger';

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
  /** A run's log from a byte offset — read-only. */
  readLog: (entry: ChainStep, run: StepRun, start: number) => Promise<LogChunk>;
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
  const [targetEnv, setTargetEnv] = useState(session.targetEnv);
  const [connections, setConnections] = useState<Record<string, Connection>>({});
  const [chain, setChain] = useState<ChainStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [allHeads, setAllHeads] = useState<BranchHead[]>();
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
    saveSession(session).catch(() => {});
  }, [session]);

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
      state.current = { ...resolved.selection, env: state.current.env };
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
    (allBranches ? allHeads : allHeads.filter((head) => matchesPatterns(head.name, watch)));

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
    readLog: (entry, run, start) =>
      readLog(project, connectionsRef.current, env, entry, run, branch ?? '', targetEnv, start),
    send: (planned, protectedEnv) =>
      sendTrigger(project, connectionsRef.current, env, planned, {
        confirmed: true,
        protectedEnv,
        targetEnv,
      }),
  };
};

export default useDepli;

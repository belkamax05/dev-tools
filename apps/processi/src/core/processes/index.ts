import { readFile } from 'node:fs/promises';
import { sep } from 'node:path';

import listProcesses, {
  descendantsOf,
  getProcessCwds,
  type ProcessInfo,
} from '@/dev-tools/utils/process/listProcesses';
import stopProcess, { type StopResult } from '@/dev-tools/utils/process/stopProcess';

export const SORT_KEYS = ['cpu', 'mem', 'pid', 'name', 'time'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Whose processes to show: everyone's, this user's, or the ones working inside the current folder. */
export const SCOPES = ['all', 'mine', 'here'] as const;
export type Scope = (typeof SCOPES)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  cpu: 'CPU',
  mem: 'Memory',
  pid: 'PID',
  name: 'Name',
  time: 'Uptime',
};

export const SCOPE_LABELS: Record<Scope, string> = {
  all: 'All',
  mine: 'Mine',
  here: 'This folder',
};

export interface ProcessRow extends ProcessInfo {
  /** Working directory, when this user may read it — always filled in for the `here` scope. */
  cwd?: string;
  /** Depth in the tree view; 0 in the flat one. */
  depth: number;
}

export interface Snapshot {
  rows: ProcessRow[];
  /** Every process, before scope and filter — for parents and children outside the view. */
  all: ProcessInfo[];
  takenAt: number;
}

/** Clock ticks per second of `/proc/<pid>/stat`'s times — 100 on every mainstream kernel build. */
const CLOCK_TICKS = 100;

interface CpuSample {
  at: number;
  ticks: Map<number, number>;
}

let previousSample: CpuSample | undefined;

const readTicks = async (pids: number[]): Promise<Map<number, number>> => {
  const ticks = new Map<number, number>();
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        //? The name field is in parentheses and may itself contain spaces and parentheses —
        //? count fields from the last `)` instead
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        //? utime and stime are fields 14 and 15 of the whole line: 12 and 13 after the name
        ticks.set(pid, Number(fields[11]) + Number(fields[12]));
      } catch {}
    }),
  );
  return ticks;
};

/**
 * CPU use *now*, the way top and btop show it: CPU time spent since the previous sample, over the
 * wall time since then.
 *
 * `ps`'s own `%cpu` on Linux is the average over the process's whole life — a build that pegged a
 * core for a minute an hour ago still reads 2%, and one that just started spinning reads nearly 0.
 * Linux keeps the running totals in `/proc/<pid>/stat`, so two samples give the real figure. The
 * first call has nothing to compare against and keeps `ps`'s numbers; so does macOS, whose `ps`
 * already reports a recent, decaying average.
 */
const withLiveCpu = async (processes: ProcessInfo[]): Promise<ProcessInfo[]> => {
  if (process.platform !== 'linux') return processes;
  const now = Date.now();
  const ticks = await readTicks(processes.map((proc) => proc.pid));
  const previous = previousSample;
  previousSample = { at: now, ticks };
  if (!previous || now - previous.at < 200) return processes;
  const seconds = (now - previous.at) / 1000;
  return processes.map((proc) => {
    const was = previous.ticks.get(proc.pid);
    const is = ticks.get(proc.pid);
    if (was === undefined || is === undefined) return proc;
    return { ...proc, cpu: Math.max(0, ((is - was) / CLOCK_TICKS / seconds) * 100) };
  });
};

/** Take a sample now so the next snapshot has live CPU figures — for a one-shot CLI listing. */
export const primeCpu = async (): Promise<void> => {
  if (process.platform !== 'linux') return;
  await withLiveCpu(await listProcesses());
};

export const isInside = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

export const matchesQuery = (proc: ProcessInfo, query: string): boolean => {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    String(proc.pid) === needle ||
    proc.name.toLowerCase().includes(needle) ||
    proc.command.toLowerCase().includes(needle) ||
    proc.user.toLowerCase().includes(needle)
  );
};

const compare: Record<SortKey, (a: ProcessInfo, b: ProcessInfo) => number> = {
  //? Descending for the "how much" columns — the heaviest first is why anyone sorts by them
  cpu: (a, b) => b.cpu - a.cpu || b.mem - a.mem,
  mem: (a, b) => b.rss - a.rss,
  pid: (a, b) => a.pid - b.pid,
  name: (a, b) => a.name.localeCompare(b.name) || a.pid - b.pid,
  time: (a, b) => b.elapsedSeconds - a.elapsedSeconds,
};

export const sortProcesses = <T extends ProcessInfo>(list: T[], key: SortKey): T[] =>
  [...list].sort(compare[key]);

/**
 * Lay the visible processes out as a forest: each one under its parent when the parent is visible
 * too, otherwise as a root. Siblings keep the chosen sort, so "by CPU" still puts the busiest
 * child of each parent first.
 */
export const toTree = (rows: ProcessRow[], key: SortKey): ProcessRow[] => {
  const visible = new Set(rows.map((row) => row.pid));
  const children = new Map<number, ProcessRow[]>();
  const roots: ProcessRow[] = [];
  for (const row of rows) {
    if (row.ppid !== row.pid && visible.has(row.ppid)) {
      const list = children.get(row.ppid) ?? [];
      list.push(row);
      children.set(row.ppid, list);
    } else roots.push(row);
  }
  const out: ProcessRow[] = [];
  const walk = (list: ProcessRow[], depth: number) => {
    for (const row of sortProcesses(list, key)) {
      out.push({ ...row, depth });
      walk(children.get(row.pid) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return out;
};

export interface SnapshotOptions {
  scope: Scope;
  sort: SortKey;
  query?: string;
  tree?: boolean;
  /** The folder the `here` scope means — the directory processi was started in. */
  root: string;
}

/** One read of the process table, scoped, filtered and sorted for display. */
export const getSnapshot = async ({
  scope,
  sort,
  query = '',
  tree = false,
  root,
}: SnapshotOptions): Promise<Snapshot> => {
  const all = await withLiveCpu(await listProcesses());
  const uid = process.getuid?.();
  let rows: ProcessRow[] = all.map((proc) => ({ ...proc, depth: 0 }));
  if (scope !== 'all') rows = rows.filter((row) => uid === undefined || row.uid === uid);
  if (scope === 'here') {
    const cwds = await getProcessCwds(rows.map((row) => row.pid));
    rows = rows
      .map((row) => ({ ...row, cwd: cwds.get(row.pid) }))
      .filter((row) => row.cwd !== undefined && isInside(row.cwd, root));
  }
  rows = rows.filter((row) => matchesQuery(row, query));
  return {
    rows: tree ? toTree(rows, sort) : sortProcesses(rows, sort),
    all,
    takenAt: Date.now(),
  };
};

/** The working directory of one process, for the detail pane. */
export const getCwd = async (pid: number): Promise<string | undefined> =>
  (await getProcessCwds([pid])).get(pid);

export interface StopPidOptions {
  force?: boolean;
  /** Stop everything it started too, children first. */
  tree?: boolean;
}

/** Stop a process (and, with `tree`, its descendants), re-reading the table first. */
export const stopPids = async (
  pids: number[],
  { force = false, tree = false }: StopPidOptions = {},
): Promise<StopResult[]> => {
  const table = tree ? await listProcesses() : [];
  const targets = [...new Set(pids.flatMap((pid) => (tree ? descendantsOf(pid, table) : [pid])))];
  const results: StopResult[] = [];
  //? One at a time, children first: a parent stopped before its child can restart it
  for (const pid of targets) results.push(await stopProcess(pid, { force }));
  return results;
};

/** What `ps`'s state letter means, for the detail pane. */
export const describeState = (state: string): string => {
  const main: Record<string, string> = {
    R: 'running',
    S: 'sleeping',
    D: 'waiting on I/O (uninterruptible)',
    I: 'idle kernel thread',
    T: 'stopped',
    t: 'stopped by a debugger',
    Z: 'zombie — exited, waiting for its parent to reap it',
    X: 'dead',
    U: 'waiting (uninterruptible)',
  };
  return main[state[0] ?? ''] ?? state;
};

export const formatRss = (kib: number): string =>
  kib >= 1024 * 1024
    ? `${(kib / 1024 / 1024).toFixed(1)}G`
    : kib >= 1024
      ? `${Math.round(kib / 1024)}M`
      : `${kib}K`;

import listProcesses, {
  descendantsOf,
  type ProcessInfo,
} from '@/dev-tools/utils/process/listProcesses';
import stopProcess, { type StopResult } from '@/dev-tools/utils/process/stopProcess';

import type { WatchedPort } from '../../config/settings';
import listListeners, { type Listener } from '../listening';

export interface PortOwner {
  pid: number;
  /** From the process table; missing when the process exited between the two reads. */
  process?: ProcessInfo;
  /** Its parent — usually the watcher or package script that will restart it if it dies. */
  parent?: ProcessInfo;
  /** Short name from the socket table, for when `process` is missing. */
  command?: string;
}

export interface PortStatus {
  port: number;
  /** The name it is watched under, when it is one of the watched ports. */
  name?: string;
  /** What the watched entry says it is for. */
  description?: string;
  watched: boolean;
  /** Every address it is bound on — `*`, `127.0.0.1`, `::1`, … */
  addresses: string[];
  owners: PortOwner[];
  /** Taken, but by a process this user may not see — another user's, and porti is not root. */
  hiddenOwner: boolean;
}

export const isBusy = (status: PortStatus): boolean =>
  status.owners.length > 0 || status.hiddenOwner;

/**
 * One snapshot of the machine's ports: every watched port (free or not) plus, with `all`, every
 * other port something is listening on.
 *
 * The socket table and the process table are read once each and joined here, so a refresh costs
 * two commands however many ports there are.
 */
export const getPortStatuses = async (
  watched: WatchedPort[],
  { all = false }: { all?: boolean } = {},
): Promise<PortStatus[]> => {
  const [listeners, processes] = await Promise.all([listListeners(), listProcesses()]);
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const byPort = new Map<number, Listener[]>();
  for (const listener of listeners) {
    const list = byPort.get(listener.port) ?? [];
    list.push(listener);
    byPort.set(listener.port, list);
  }

  const ports = new Set(watched.map((entry) => entry.port));
  if (all) for (const port of byPort.keys()) ports.add(port);

  return [...ports]
    .sort((a, b) => a - b)
    .map((port) => {
      const sockets = byPort.get(port) ?? [];
      const owners = new Map<number, PortOwner>();
      for (const socket of sockets) {
        if (socket.pid === undefined || owners.has(socket.pid)) continue;
        const proc = byPid.get(socket.pid);
        owners.set(socket.pid, {
          pid: socket.pid,
          process: proc,
          parent: proc ? byPid.get(proc.ppid) : undefined,
          command: socket.command,
        });
      }
      const entry = watched.find((candidate) => candidate.port === port);
      return {
        port,
        name: entry?.name,
        description: entry?.description,
        watched: Boolean(entry),
        addresses: [...new Set(sockets.map((socket) => socket.address))],
        owners: [...owners.values()],
        hiddenOwner: sockets.some((socket) => socket.pid === undefined),
      };
    });
};

/**
 * `node (1234)`. The socket table's name first: it is the kernel's `comm`, which is right even
 * for a process re-exec'd through `/proc/self/exe` (every Chromium helper), where the command
 * line's first word says only `exe`.
 */
export const describeOwner = (owner: PortOwner): string =>
  `${owner.command ?? owner.process?.name ?? 'pid'} (${owner.pid})`;

export interface StopPortOptions {
  force?: boolean;
  /** Stop everything the owner started as well, children first. */
  tree?: boolean;
}

/**
 * Stop whatever holds a port: each owning process (and, with `tree`, what it started).
 *
 * The process table is re-read rather than trusted from the snapshot on screen — the port may
 * have changed hands since, and signalling a pid from a stale snapshot is how the wrong process
 * gets killed.
 */
export const stopPort = async (
  port: number,
  { force = false, tree = false }: StopPortOptions = {},
): Promise<StopResult[]> => {
  const [status] = await getPortStatuses([{ port }]);
  if (!status?.owners.length) return [];
  const processes = tree ? await listProcesses() : [];
  const pids = [
    ...new Set(
      status.owners.flatMap((owner) => (tree ? descendantsOf(owner.pid, processes) : [owner.pid])),
    ),
  ];
  const results: StopResult[] = [];
  //? One at a time, children first: a parent stopped before its child can restart it
  for (const pid of pids) results.push(await stopProcess(pid, { force }));
  return results;
};

/** Stop one process by pid — the dashboard's "stop the parent" action. */
export const stopPid = (pid: number, force = false) => stopProcess(pid, { force });

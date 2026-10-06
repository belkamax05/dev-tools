import { readlink } from 'node:fs/promises';

import exec from '../exec';

export interface ProcessInfo {
  pid: number;
  ppid: number;
  uid: number;
  /** Truncated by procps to 8 characters with a `+` — compare `uid` to tell whose it is. */
  user: string;
  /** Percent of one core, as `ps` reports it — above 100 on a multi-threaded process. */
  cpu: number;
  /** Percent of physical memory. */
  mem: number;
  /** Resident set size in KiB. */
  rss: number;
  /** How long it has been running, as `ps` prints it: `[[dd-]hh:]mm:ss`. */
  elapsed: string;
  /** `elapsed` in seconds, for sorting. */
  elapsedSeconds: number;
  /** `ps`'s state letters — `R` running, `S` sleeping, `Z` zombie, `T` stopped, and modifiers. */
  state: string;
  /** The full command line. */
  command: string;
  /** The executable's base name, from the command line's first word. */
  name: string;
}

//? The same keywords on procps (Linux) and BSD ps (macOS); `=` on each drops the header row.
//? `args` is last because it is the only column that can contain spaces.
const PS_COLUMNS = 'pid=,ppid=,uid=,user=,pcpu=,pmem=,rss=,etime=,stat=,args=';

/** The executable's base name: `/usr/bin/node server.js` → `node`, `[kworker/0:1]` stays as is. */
export const processName = (command: string): string => {
  if (command.startsWith('[')) return command;
  const first = command.split(/\s+/)[0] ?? '';
  return first.split('/').pop() || first;
};

/** `ps`'s `etime` — `[[dd-]hh:]mm:ss` — in seconds. */
export const parseElapsed = (value: string): number => {
  const [days, clock = ''] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = clock.split(':').map(Number).reverse();
  const [seconds = 0, minutes = 0, hours = 0] = parts;
  return Number(days) * 86400 + hours * 3600 + minutes * 60 + seconds;
};

/**
 * Parse `ps -o pid=,ppid=,uid=,user=,pcpu=,pmem=,rss=,etime=,stat=,args=` output.
 *
 * Split on whitespace for the first nine columns only: everything after them is the command
 * line, spaces and all.
 */
export const parsePs = (stdout: string): ProcessInfo[] => {
  const out: ProcessInfo[] = [];
  for (const line of stdout.split('\n')) {
    const match = line
      .trim()
      .match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+([\d.,]+)\s+([\d.,]+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/,
      );
    if (!match) continue;
    const [, pid, ppid, uid, user, cpu, mem, rss, elapsed = '', state, command = ''] = match;
    //? Some locales print a decimal comma
    const num = (value = '0') => Number.parseFloat(value.replace(',', '.')) || 0;
    out.push({
      pid: Number(pid),
      ppid: Number(ppid),
      uid: Number(uid),
      user: user ?? '',
      cpu: num(cpu),
      mem: num(mem),
      rss: Number(rss) || 0,
      elapsed,
      elapsedSeconds: parseElapsed(elapsed),
      state: state ?? '',
      command,
      name: processName(command),
    });
  }
  return out;
};

/**
 * Every process on the machine, as `ps` sees it — the processes of other users included, which
 * can be listed but not signalled without their owner's (or root's) rights.
 *
 * @returns An empty list when `ps` is missing or fails; a process table is never worth throwing for
 */
export const listProcesses = async (): Promise<ProcessInfo[]> => {
  const [result, comms] = await Promise.all([
    exec(['ps', '-A', '-ww', '-o', PS_COLUMNS]),
    //? Separately, because `comm` may contain spaces ("Web Content") and only one column can
    exec(['ps', '-A', '-o', 'pid=,comm=']),
  ]);
  if (result.exitCode !== 0) return [];
  const comm = new Map<number, string>();
  for (const line of comms.stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (match?.[1] && match[2]) comm.set(Number(match[1]), match[2].split('/').pop() ?? match[2]);
  }
  return parsePs(result.stdout).map((proc) => {
    //? A process re-exec'd through `/proc/self/exe` — every Chromium and Electron helper — has
    //? only "exe" as its first word; the kernel's name for it is the useful one
    const kernelName = comm.get(proc.pid);
    return (proc.name === 'exe' || !proc.name) && kernelName ? { ...proc, name: kernelName } : proc;
  });
};

/**
 * Each process's working directory, for the ones this user may read.
 *
 * Linux exposes it as `/proc/<pid>/cwd`; macOS has no `/proc`, so one `lsof` call asks for the
 * current directory of every process this user owns. A process whose directory cannot be read
 * (another user's, or already gone) is simply absent from the map.
 */
export const getProcessCwds = async (pids: number[]): Promise<Map<number, string>> => {
  const cwds = new Map<number, string>();
  if (process.platform === 'linux') {
    await Promise.all(
      pids.map(async (pid) => {
        try {
          cwds.set(pid, await readlink(`/proc/${pid}/cwd`));
        } catch {}
      }),
    );
    return cwds;
  }
  const result = await exec([
    'lsof',
    '-a',
    '-d',
    'cwd',
    '-u',
    String(process.getuid?.() ?? ''),
    '-Fpn',
  ]);
  let pid = 0;
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
};

/** A process and everything it started, children before parents — the order to stop them in. */
export const descendantsOf = (pid: number, processes: ProcessInfo[]): number[] => {
  const children = new Map<number, number[]>();
  for (const proc of processes) {
    const list = children.get(proc.ppid) ?? [];
    list.push(proc.pid);
    children.set(proc.ppid, list);
  }
  const out: number[] = [];
  const visit = (at: number, seen: Set<number>) => {
    if (seen.has(at)) return;
    seen.add(at);
    for (const child of children.get(at) ?? []) visit(child, seen);
    out.push(at);
  };
  visit(pid, new Set());
  return out;
};

export default listProcesses;

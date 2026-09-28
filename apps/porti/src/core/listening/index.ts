import exec from '@/dev-tools/utils/process/exec';

/** One listening TCP socket. */
export interface Listener {
  port: number;
  /** The local address it is bound to — `*`, `0.0.0.0`, `::`, `127.0.0.1`, … */
  address: string;
  /** Unknown when the socket belongs to another user and porti is not running as root. */
  pid?: number;
  /** The process name the socket table reports, which is the short `comm`, not the command line. */
  command?: string;
}

/** `[::1]` → `::1`, `127.0.0.53%lo` → `127.0.0.53`. */
const cleanAddress = (address: string) => address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');

/** Split `host:port` at the last colon — IPv6 addresses carry colons of their own. */
const splitHostPort = (value: string): { address: string; port: number } | undefined => {
  const at = value.lastIndexOf(':');
  if (at < 0) return undefined;
  const port = Number(value.slice(at + 1));
  if (!Number.isInteger(port) || port <= 0) return undefined;
  return { address: cleanAddress(value.slice(0, at)), port };
};

/**
 * Parse `ss -H -t -l -n -p`.
 *
 * `LISTEN 0 511 *:3000 *:* users:(("node",pid=1234,fd=20),("node",pid=1240,fd=20))` — one line
 * per socket, with every process holding it. A socket of another user's has no `users:` part
 * unless ss runs as root; it is still listed, with no pid, so the port shows as taken.
 */
export const parseSs = (stdout: string): Listener[] => {
  const out: Listener[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    //? State, Recv-Q, Send-Q, Local, Peer, [Process]
    const local = parts[3];
    if (!local) continue;
    const hostPort = splitHostPort(local);
    if (!hostPort) continue;
    const owners = [...line.matchAll(/\("([^"]*)",pid=(\d+)/g)];
    if (!owners.length) {
      out.push(hostPort);
      continue;
    }
    for (const [, command, pid] of owners) out.push({ ...hostPort, pid: Number(pid), command });
  }
  return out;
};

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` — lsof's field output, one field per line: `p` starts
 * a process, `c` is its name, and each `n` is one of its sockets.
 */
export const parseLsof = (stdout: string): Listener[] => {
  const out: Listener[] = [];
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of stdout.split('\n')) {
    const field = line[0];
    const value = line.slice(1);
    if (field === 'p') {
      pid = Number(value);
      command = undefined;
    } else if (field === 'c') command = value;
    else if (field === 'n') {
      const hostPort = splitHostPort(value);
      if (hostPort) out.push({ ...hostPort, pid, command });
    }
  }
  return out;
};

/** One socket per address, port and process: IPv4 and IPv6 listings of the same bind overlap. */
const dedupe = (listeners: Listener[]): Listener[] => {
  const seen = new Set<string>();
  return listeners.filter((entry) => {
    const key = `${entry.port}|${entry.address}|${entry.pid ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * Every listening TCP socket on the machine.
 *
 * `ss` first on Linux — it reads the kernel's socket table directly and is an order of magnitude
 * faster than lsof, which matters at a refresh every second or two. `lsof` is the fallback, and
 * the only option on macOS.
 */
export const listListeners = async (): Promise<Listener[]> => {
  if (process.platform === 'linux') {
    const ss = await exec(['ss', '-H', '-t', '-l', '-n', '-p']);
    if (ss.exitCode === 0) return dedupe(parseSs(ss.stdout));
  }
  const lsof = await exec(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']);
  //? lsof exits 1 when nothing matched, which is an answer, not a failure
  return dedupe(parseLsof(lsof.stdout));
};

export default listListeners;

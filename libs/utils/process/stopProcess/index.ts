export interface StopOptions {
  /** Skip SIGTERM and send SIGKILL straight away. */
  force?: boolean;
  /** How long SIGTERM gets before the process is killed outright. */
  graceMs?: number;
  /** Send SIGKILL if SIGTERM has not worked within `graceMs`. Defaults to true. */
  escalate?: boolean;
}

export interface StopResult {
  pid: number;
  ok: boolean;
  /** The last signal sent, or undefined when none could be. */
  signal?: 'SIGTERM' | 'SIGKILL';
  message: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Whether a process exists. Signal 0 checks without delivering anything; `EPERM` means it exists
 * but belongs to someone else.
 */
export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const waitForExit = async (pid: number, ms: number): Promise<boolean> => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!isAlive(pid)) return true;
    await sleep(100);
  }
  return !isAlive(pid);
};

const describeError = (pid: number, error: unknown): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EPERM') return `Not allowed to signal ${pid} — it belongs to another user (sudo?)`;
  if (code === 'ESRCH') return `${pid} had already exited`;
  return `Could not signal ${pid}: ${(error as Error).message}`;
};

/**
 * Stop a process the polite way first: SIGTERM, a grace period to shut down cleanly, then SIGKILL
 * if it is still there.
 *
 * Signals the one process, never its group. A dev server's watcher and the server it restarts
 * usually share a group with the terminal they were started from, and killing the group would take
 * that shell with it; stop the parent (or the tree, via `descendantsOf`) instead.
 */
export const stopProcess = async (
  pid: number,
  { force = false, graceMs = 2000, escalate = true }: StopOptions = {},
): Promise<StopResult> => {
  if (pid === process.pid) return { pid, ok: false, message: 'Refusing to stop itself' };
  if (pid <= 1) return { pid, ok: false, message: `Refusing to signal pid ${pid}` };

  const send = (signal: 'SIGTERM' | 'SIGKILL'): StopResult | undefined => {
    try {
      process.kill(pid, signal);
      return undefined;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return { pid, ok: code === 'ESRCH', message: describeError(pid, error) };
    }
  };

  if (!force) {
    const failed = send('SIGTERM');
    if (failed) return failed;
    if (await waitForExit(pid, graceMs)) {
      return {
        pid,
        ok: true,
        signal: 'SIGTERM',
        message: `Stopped ${pid} (SIGTERM)`,
      };
    }
    if (!escalate) {
      return {
        pid,
        ok: false,
        signal: 'SIGTERM',
        message: `${pid} is still running after SIGTERM — force-kill it to be sure`,
      };
    }
  }

  const failed = send('SIGKILL');
  if (failed) return failed;
  if (await waitForExit(pid, 1000)) {
    return {
      pid,
      ok: true,
      signal: 'SIGKILL',
      message: force ? `Killed ${pid} (SIGKILL)` : `${pid} ignored SIGTERM — killed (SIGKILL)`,
    };
  }
  return {
    pid,
    ok: false,
    signal: 'SIGKILL',
    message: `${pid} survived SIGKILL — a zombie waiting on its parent, or stuck in the kernel`,
  };
};

export default stopProcess;

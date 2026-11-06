import shellQuote from '@/dev-tools/utils/process/shellQuote';

/** How the command reads at a prompt: a single argument is already a shell line, kept as it is. */
export const commandLine = (command: string[]) =>
  command.length === 1 ? (command[0] as string) : shellQuote(command);

/** A file name from a command line: `bun run validate packages:lock` → `bun-run-validate-packages-lock`. */
export const slugOf = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'terminal';

/** The terminals a command can be told it runs in, and the `TERM` each sets. */
export const TERMS = { xterm: 'xterm-256color', kitty: 'xterm-kitty' } as const;
export type Term = keyof typeof TERMS;

export interface CaptureOptions {
  cwd?: string;
  /**
   * The terminal the command is told it runs in: `xterm` (xterm-256color, the default) or
   * `kitty` (xterm-kitty) - so a tool that checks for kitty prints its kitty graphics.
   */
  term?: Term;
  /** What the command is told the terminal width is; 120 by default. */
  columns?: number;
  /**
   * Seconds before the command is stopped: SIGTERM to its whole process group, so a shell line's
   * pipeline stops too, not only `sh`. What it printed by then is kept. No limit when unset.
   */
  timeout?: number;
}

//? Not in bun-types yet, though Bun supports it: the child leads its own process group
const OWN_GROUP = { detached: true };

/** SIGTERM a process group; it may already be gone. */
const stopGroup = (pid: number) => {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {}
};

/**
 * Run a command the way it would print in a colour terminal and keep everything it wrote.
 *
 * Its output is piped, so it is told outright that colour is wanted (`FORCE_COLOR`,
 * `CLICOLOR_FORCE`), and `TERM` is set to xterm-256color (xterm-kitty for `term: 'kitty'`):
 * `TERM=linux` makes tools such as clack fall back to plain ASCII. stdout and stderr share one pipe (through `sh`), so they interleave
 * in the order they were written. A single argument is a shell line, run with `sh -c`; several are
 * the command and its arguments. With a `timeout`, a command still running then is stopped and
 * comes back with `timedOut` and what it had printed.
 */
export const captureCommand = async (
  command: string[],
  { cwd, columns = 120, timeout, term = 'xterm' }: CaptureOptions = {},
) => {
  const argv =
    command.length === 1
      ? ['sh', '-c', `${command[0]} 2>&1`]
      : ['sh', '-c', 'exec "$@" 2>&1', 'sh', ...command];
  const { NO_COLOR: _, ...env } = process.env;
  const startedAt = Date.now();
  //? Only a timed run gets its own process group - that is what lets a whole pipeline be stopped -
  //? and as the group is then out of the terminal's reach, Ctrl+C is passed on to it by hand
  const timed = timeout !== undefined;
  const child = Bun.spawn(argv, {
    cwd,
    env: {
      ...env,
      TERM: TERMS[term],
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
      COLUMNS: String(columns),
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    ...(timed ? OWN_GROUP : {}),
  });
  let timedOut = false;
  const forward = () => stopGroup(child.pid);
  const timer = timed
    ? setTimeout(() => {
        timedOut = true;
        stopGroup(child.pid);
      }, timeout * 1000)
    : undefined;
  if (timed) {
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
  }
  try {
    //? Drain both pipes before awaiting `exited`, or a child that fills one blocks forever
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const exitCode = await child.exited;
    //? stderr only holds what `sh` itself says before the redirect is in place
    const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
    return { output, exitCode, timedOut, ms: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    if (timed) {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
    }
  }
};

export default captureCommand;

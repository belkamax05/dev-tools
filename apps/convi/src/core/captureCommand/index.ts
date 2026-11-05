import exec from '@/dev-tools/utils/process/exec';
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

export interface CaptureOptions {
  cwd?: string;
  /** What the command is told the terminal width is; 120 by default. */
  columns?: number;
}

/**
 * Run a command the way it would print in a colour terminal and keep everything it wrote.
 *
 * Its output is piped, so it is told outright that colour is wanted (`FORCE_COLOR`,
 * `CLICOLOR_FORCE`), and `TERM` is set to xterm-256color: `TERM=linux` makes tools such as clack
 * fall back to plain ASCII. stdout and stderr share one pipe (through `sh`), so they interleave
 * in the order they were written. A single argument is a shell line, run with `sh -c`; several are
 * the command and its arguments.
 */
export const captureCommand = async (
  command: string[],
  { cwd, columns = 120 }: CaptureOptions = {},
) => {
  const argv =
    command.length === 1
      ? ['sh', '-c', `${command[0]} 2>&1`]
      : ['sh', '-c', 'exec "$@" 2>&1', 'sh', ...command];
  const { NO_COLOR: _, ...env } = process.env;
  const startedAt = Date.now();
  const { stdout, stderr, exitCode } = await exec(argv, {
    cwd,
    env: {
      ...env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      CLICOLOR_FORCE: '1',
      COLUMNS: String(columns),
    },
  });
  //? stderr only holds what `sh` itself says before the redirect is in place
  const output = [stdout, stderr].filter(Boolean).join('\n');
  return { output, exitCode, ms: Date.now() - startedAt };
};

export default captureCommand;

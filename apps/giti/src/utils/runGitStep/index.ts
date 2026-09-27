import { log, taskLog } from '@clack/prompts';
import gitExec from '../gitExec';

export interface GitStep {
  exitCode: number | null;
  /** Everything git printed, stdout and stderr together, for a caller that wants to show it. */
  output: string;
  /** Close the step as done: its live log collapses into this one line. */
  succeed: (message: string) => void;
  /**
   * Close the step as failed: its live log stays on screen above this line — unless `quiet`,
   * for a caller whose message already explains it and whose git output would contradict it
   * (git-subrepo's "finish the pull by hand" after giti has undone the pull).
   */
  fail: (message: string, options?: { quiet?: boolean }) => void;
}

/**
 * Run one git command as a clack step: while it works, its output streams live under `title`;
 * once it finishes, the caller replaces all of that with a single result line.
 *
 * That is the shape `mr update` has for a whole run of repositories, and what a pull over many
 * vendored directories needs too — progress while something is moving, and afterwards one line
 * per directory instead of every "Fast-forward" and diffstat git printed.
 *
 * ! clack's task log redraws in place with cursor escapes, which is only meaningful on a
 * ! terminal of known width. Piped (a log file, `mr`, a script) or unsized, the output is
 * ! collected silently instead, and printed only if the step fails — where it is the explanation.
 *
 * @param title - What is happening, shown above the live output
 * @param args - git arguments
 * @param cwd - Directory to run git in
 */
const runGitStep = async (title: string, args: string[], cwd: string): Promise<GitStep> => {
  //? A terminal of unknown width counts as no terminal: the task log sizes what it erases by
  //? dividing each line's length by the column count, and zero columns (a pty nobody sized, like
  //? `script` without `stty cols`) makes that Infinity — clack 1.8.1 then loops until it runs out
  //? of memory on the step's first success.
  if (!process.stdout.isTTY || !(process.stdout.columns > 0)) {
    const result = await gitExec(args, cwd);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return {
      exitCode: result.exitCode,
      output,
      succeed: (message) => log.success(message),
      fail: (message, { quiet = false } = {}) => {
        log.error(message);
        if (output && !quiet) log.message(output.split('\n'));
      },
    };
  }

  const task = taskLog({ title, limit: 8 });
  const lines: string[] = [];
  const result = await gitExec(args, cwd, {
    onLine: (line) => {
      lines.push(line);
      task.message(line);
    },
  });

  return {
    exitCode: result.exitCode,
    output: lines.join('\n'),
    succeed: (message) => task.success(message),
    fail: (message, { quiet = false } = {}) => task.error(message, { showLog: !quiet }),
  };
};

export default runGitStep;

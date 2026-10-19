import gitExec from '../gitExec';
import stepProgress from '../stepProgress';

export interface GitStep {
  exitCode: number | null;
  /** Everything git printed, stdout and stderr together, for a caller that wants to show it. */
  output: string;
  /** Close the step as done: the spinner gives way to this one line. */
  succeed: (message: string) => void;
  /**
   * Close the step as failed: this line, then what git printed, which is the explanation —
   * unless `quiet`, for a caller whose message already explains it and whose git output would
   * contradict it (git-subrepo's "finish the pull by hand" after giti has undone the pull).
   */
  fail: (message: string, options?: { quiet?: boolean }) => void;
  /**
   * Close the step as not done, but not as an error either: this one line, and none of what git
   * printed — for a refusal the caller has already explained and that the run lets pass.
   */
  warn: (message: string) => void;
}

/**
 * Run one git command as a step of a clack run: while it works, the run's spinner shows `title`
 * and git's latest line beside it; once it finishes, the caller replaces all of that with a
 * single result line.
 *
 * That is the shape `mr update` has for a whole run of repositories, and what a pull over many
 * vendored directories needs too — something visibly moving while git does, and afterwards one
 * line per directory instead of every "Fast-forward" and diffstat git printed.
 *
 * ! The spinner is only drawn on a terminal of known width (see `stepProgress`). Piped (a log
 * ! file, `mr`, a script) or unsized, the output is collected silently instead, and printed only
 * ! if the step fails — where it is the explanation.
 *
 * @param title - What is happening, shown beside the spinner
 * @param args - git arguments
 * @param cwd - Directory to run git in
 */
const runGitStep = async (title: string, args: string[], cwd: string): Promise<GitStep> => {
  stepProgress.working(title);
  const lines: string[] = [];
  const result = await gitExec(args, cwd, {
    onLine: (line) => {
      lines.push(line);
      //? git's progress ("Receiving objects: 42%") is the best sign the step is not stuck
      const latest = line.trim();
      if (latest) stepProgress.working(`${title} · ${latest}`);
    },
  });
  const output = lines.join('\n');

  return {
    exitCode: result.exitCode,
    output,
    succeed: (message) => stepProgress.log.success(message),
    fail: (message, { quiet = false } = {}) => {
      stepProgress.log.error(message);
      if (output && !quiet) stepProgress.log.message(output.split('\n'));
    },
    warn: (message) => stepProgress.log.warn(message),
  };
};

export default runGitStep;

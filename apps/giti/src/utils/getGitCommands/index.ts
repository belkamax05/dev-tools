import gitExec from '../gitExec';

/**
 * The commands git itself answers to, by kind — what a giti alias must not be named, since git
 * runs its own command and ignores an alias of the same name without a word.
 *
 * - `main`: git's built-ins and the programs shipped with it (`push`, `pull`, `log`, …).
 * - `others`: `git-*` programs found on `PATH` (`git-subrepo`, `git-lfs`, …) — this machine's,
 *   so the list differs between machines.
 *
 * Read from `git --list-cmds`, the list git's own completion is built from.
 *
 * @param cwd - Where to run git; any directory works
 */
const getGitCommands = async (cwd: string) => {
  const list = async (kind: 'main' | 'others') => {
    const result = await gitExec([`--list-cmds=${kind}`], cwd);
    if (result.exitCode !== 0) throw new Error(`git --list-cmds=${kind} failed: ${result.stderr}`);
    return new Set(result.stdout.split('\n').map((line) => line.trim()).filter(Boolean));
  };
  const [main, others] = await Promise.all([list('main'), list('others')]);
  return { main, others };
};

export default getGitCommands;

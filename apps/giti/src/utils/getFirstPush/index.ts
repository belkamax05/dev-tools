import getRemotes from '../getRemotes';
import gitExec from '../gitExec';

export interface FirstPush {
  /** The branch checked out, which has no upstream yet. */
  branch: string;
  /** Where its first push goes and what it will track from then on, e.g. `origin`. */
  remote: string;
}

/**
 * Whether the repository at `cwd` is on a branch whose next push needs `--set-upstream`.
 *
 * That is exactly the case `git push` refuses with "has no upstream branch": a branch checked out
 * whose `@{u}` does not resolve. Once one push has set it, `@{u}` resolves and this returns null,
 * so the flag is only ever added to a branch's first push. Used for the repository itself and for
 * each submodule — a submodule is a repository of its own, with its own branches.
 *
 * ! Null for a detached HEAD (there is no branch to track anything) and for a repository with no
 * ! remote at all (there is nowhere to push to); both are reported by the push itself.
 *
 * @param cwd - Any directory inside the repository
 * @returns The branch and the remote its first push goes to, or null when a plain push will do
 */
const getFirstPush = async (cwd: string): Promise<FirstPush | null> => {
  const [head, tracked] = await Promise.all([
    gitExec(['symbolic-ref', '-q', '--short', 'HEAD'], cwd),
    gitExec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd),
  ]);
  const branch = head.exitCode === 0 ? head.stdout.trim() : '';
  if (!branch || (tracked.exitCode === 0 && tracked.stdout.trim())) return null;

  //? The remote git itself would pick: the configured push default, else origin, else the only one
  const [pushDefault, remotes] = await Promise.all([
    gitExec(['config', 'remote.pushDefault'], cwd),
    getRemotes(cwd),
  ]);
  const configured = pushDefault.exitCode === 0 ? pushDefault.stdout.trim() : '';
  const remote = configured || (remotes.includes('origin') ? 'origin' : remotes[0]);
  return remote ? { branch, remote } : null;
};

export default getFirstPush;

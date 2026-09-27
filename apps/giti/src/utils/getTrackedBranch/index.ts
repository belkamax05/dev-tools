import gitExec from '../gitExec';

export interface TrackedBranch {
  /** Remote name the branch pulls from, e.g. `origin`. */
  remote: string;
  /** Branch on that remote, without `refs/heads/`. */
  branch: string;
  /** How git itself would name it, e.g. `origin/release-sprint-26.13`. */
  label: string;
}

/**
 * The upstream the branch checked out in `cwd` pulls from, or null when there is none to follow.
 *
 * Exists for submodules, where "which branch is upstream" has two competing answers:
 * `.gitmodules`' `branch` (or, without one, the remote's default branch), which is what
 * `git submodule update --remote` follows, and the branch someone actually checked out inside the
 * submodule to work on. When a person has switched a submodule onto a branch, that branch is the
 * one they mean — following the remote default instead merges `main` into a release branch.
 *
 * ! Null for a detached HEAD, a branch without an upstream, and one tracking a local branch
 * ! (`branch.<name>.remote = .`): in all three there is no remote branch to fetch from.
 *
 * @param cwd - Any directory inside the repository to ask about
 * @returns The tracked remote branch, or null
 */
const getTrackedBranch = async (cwd: string): Promise<TrackedBranch | null> => {
  const head = await gitExec(['symbolic-ref', '-q', '--short', 'HEAD'], cwd);
  if (head.exitCode !== 0) return null;
  const local = head.stdout.trim();
  if (!local) return null;

  const [remoteResult, mergeResult] = await Promise.all([
    gitExec(['config', `branch.${local}.remote`], cwd),
    gitExec(['config', `branch.${local}.merge`], cwd),
  ]);
  const remote = remoteResult.exitCode === 0 ? remoteResult.stdout.trim() : '';
  const branch =
    mergeResult.exitCode === 0 ? mergeResult.stdout.trim().replace(/^refs\/heads\//, '') : '';
  if (!remote || remote === '.' || !branch) return null;

  return { remote, branch, label: `${remote}/${branch}` };
};

export default getTrackedBranch;

import gitExec from '../gitExec';

/**
 * The worktree git-subrepo builds under `.git/tmp/subrepo/<dir>` for a pull or a push, when one
 * is still registered. A pull or push that stopped half-way leaves it, and every later pull of that
 * subrepo then fails with "There is already a worktree with branch subrepo/<dir>". It is knowable
 * up front.
 *
 * ! The worktree is the tell, not the `subrepo/<dir>` branch. git-subrepo keeps that branch after
 * ! every *successful* pull (it is what a later `git subrepo push` starts from), and a pull with
 * ! the branch present but no worktree on it works fine — checked against git-subrepo 0.4.9.
 * ! Testing for the branch refused to pull any subrepo that had ever been pulled before.
 *
 * @returns The worktree's path, or undefined when there is none
 */
const subrepoWorktree = async (dir: string, cwd: string) => {
  const worktrees = await gitExec(['worktree', 'list', '--porcelain'], cwd);
  if (worktrees.exitCode !== 0) return undefined;
  //? Porcelain output is blank-line separated records: `worktree <path>` first, then `branch`.
  for (const record of worktrees.stdout.split('\n\n')) {
    const lines = record.split('\n');
    if (lines.includes(`branch refs/heads/subrepo/${dir}`)) {
      return lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    }
  }
  return undefined;
};

/** Unregister and delete that worktree — it holds nothing a later pull or push needs. */
export const removeSubrepoWorktree = async (dir: string, cwd: string) => {
  const worktree = await subrepoWorktree(dir, cwd);
  if (worktree) await gitExec(['worktree', 'remove', '--force', worktree], cwd);
  await gitExec(['worktree', 'prune'], cwd);
};

export default subrepoWorktree;

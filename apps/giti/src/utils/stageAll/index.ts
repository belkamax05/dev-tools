import GitError from '../../types/GitError';
import gitExec from '../gitExec';

/**
 * Stage every change in the work tree — new, modified and deleted files alike.
 *
 * `-A` rather than `.`: `git add .` stages only the folder git runs in, so `giti wip` typed in a
 * subfolder (rather than through the git alias, which runs from the top) left the rest unstaged.
 */
const stageAll = async (cwd: string) => {
  const result = await gitExec(['add', '-A'], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
};

export default stageAll;

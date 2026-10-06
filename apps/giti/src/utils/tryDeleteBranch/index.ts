import type GitResult from '../../types/GitResult';
import gitExec from '../gitExec';

//? Spread straight from gitExec, so the result is a GitResult plus the flag. Spelling the fields
//? out again let `exitCode` drift to a bare `number`, which the controller's non-strict tsconfig
//? accepted but is a lie: gitExec reports `null` when the child is killed by a signal.
type TryDeleteResult = GitResult & {
  notFullyMerged: boolean;
};

/**
 * Attempts a safe branch delete (-d).
 * Returns structured result including whether the failure was due to unmerged commits.
 */
const tryDeleteBranch = async (cwd: string, branch: string): Promise<TryDeleteResult> => {
  const result = await gitExec(['branch', '-d', branch], cwd);
  const notFullyMerged = result.exitCode !== 0 && result.stderr.includes('not fully merged');
  return { ...result, notFullyMerged };
};

export default tryDeleteBranch;

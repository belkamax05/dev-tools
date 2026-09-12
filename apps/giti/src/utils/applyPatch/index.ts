import GitError from '../../types/GitError';
import gitExec from '../gitExec';

/**
 * Applies a patch file using the standard git apply pipeline:
 *   1. --stat  : show what the patch would affect
 *   2. --check : dry-run to detect conflicts before touching the tree
 *   3. apply   : actually apply the changes
 *
 * All applied changes land as **unstaged** working-tree edits. This is expected
 * behaviour — `git apply` writes to the working tree only, so the receiving
 * developer stages what they need afterwards.
 *
 * Throws GitError on any failure so callers don't need to inspect exit codes.
 * @param cwd - Working directory (git repo root)
 * @param patchPath - Absolute path to the .patch file
 */
const applyPatch = async (cwd: string, patchPath: string): Promise<void> => {
  const statResult = await gitExec(['apply', '--stat', patchPath], cwd);
  if (statResult.exitCode !== 0) throw new GitError(statResult);
  if (statResult.stdout) console.log(statResult.stdout);
  if (statResult.stderr) console.log(statResult.stderr);

  const checkResult = await gitExec(['apply', '--check', patchPath], cwd);
  if (checkResult.exitCode !== 0) throw new GitError(checkResult);

  const applyResult = await gitExec(['apply', patchPath], cwd);
  if (applyResult.exitCode !== 0) throw new GitError(applyResult);
};

export default applyPatch;

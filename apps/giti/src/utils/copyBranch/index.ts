import gitExec from '../gitExec';

/**
 * Copies changes from another branch into the working tree without committing.
 * Equivalent to: git merge --no-commit --squash <branch> && git reset HEAD
 *
 * Leaves all changes from the source branch unstaged in the working directory.
 */
const copyBranch = async (cwd: string, branch: string) => {
  const mergeResult = await gitExec(['merge', '--no-commit', '--squash', branch], cwd);
  if (mergeResult.exitCode !== 0) return mergeResult;

  return gitExec(['reset', 'HEAD'], cwd);
};

export default copyBranch;

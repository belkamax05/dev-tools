import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getCommitDetails = async (cwd: string, commitHash: string) => {
  const result = await gitExec(['show', '--stat', commitHash], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
  return result.stdout;
};

export default getCommitDetails;

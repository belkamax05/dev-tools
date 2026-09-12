import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getBranch = async (cwd: string) => {
  const result = await gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (result.exitCode !== 0) {
    throw new GitError(result);
  }
  return result.stdout;
};

export default getBranch;

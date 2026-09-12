import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const unstageAll = async (cwd: string) => {
  const result = await gitExec(['reset'], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
};

export default unstageAll;

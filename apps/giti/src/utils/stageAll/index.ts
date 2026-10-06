import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const stageAll = async (cwd: string) => {
  const result = await gitExec(['add', '.'], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
};

export default stageAll;

import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getStatus = async (cwd: string) => {
  // Force index refresh to avoid stale "staged" states when timestamps differ but content matches
  await gitExec(['update-index', '-q', '--refresh'], cwd).catch(() => {});

  const result = await gitExec(['status', '--porcelain'], cwd);
  if (result.exitCode !== 0) {
    throw new GitError(result);
  }
  return result.stdout;
};

export default getStatus;

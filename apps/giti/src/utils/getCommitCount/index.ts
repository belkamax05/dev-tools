import gitExec from '../gitExec';

const getCommitCount = async (cwd: string, range: string) => {
  const result = await gitExec(['rev-list', '--count', range], cwd);
  return result.exitCode === 0 ? parseInt(result.stdout.trim(), 10) : Infinity;
};

export default getCommitCount;

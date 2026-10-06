import gitExec from '../gitExec';

const getDiffStats = async (cwd: string) => {
  const result = await gitExec(['diff', '--stat'], cwd);
  return result.stdout;
};

export default getDiffStats;

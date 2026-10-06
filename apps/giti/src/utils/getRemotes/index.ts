import gitExec from '../gitExec';

const getRemotes = async (cwd: string) => {
  const result = await gitExec(['remote'], cwd);
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\n').filter(Boolean);
};

export default getRemotes;

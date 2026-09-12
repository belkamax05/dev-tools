import gitExec from '../gitExec';

const getConfig = async (key: string, cwd: string) => {
  const result = await gitExec(['config', key], cwd);
  if (result.exitCode !== 0) return '';
  return result.stdout.trim();
};

export default getConfig;

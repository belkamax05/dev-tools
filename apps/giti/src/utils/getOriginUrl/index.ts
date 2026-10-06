import gitExec from '../gitExec';

const getOriginUrl = async (cwd: string) => {
  const result = await gitExec(['remote', 'get-url', 'origin'], cwd);
  if (result.exitCode !== 0) return '';
  return result.stdout;
};

export default getOriginUrl;

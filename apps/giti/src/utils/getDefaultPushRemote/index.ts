import gitExec from '../gitExec';

const getDefaultPushRemote = async (cwd: string) => {
  const result = await gitExec(['config', 'remote.pushdefault'], cwd);
  if (result.exitCode === 0 && result.stdout) return result.stdout.trim();
  return '';
};

export default getDefaultPushRemote;

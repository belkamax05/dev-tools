import gitExec from '../gitExec';

const getStashCount = async (cwd: string) => {
  const result = await gitExec(['stash', 'list', '--format=%h'], cwd);
  return result.exitCode === 0 ? result.stdout.split('\n').filter(Boolean).length : 0;
};

export default getStashCount;

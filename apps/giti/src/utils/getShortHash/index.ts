import gitExec from '../gitExec';

const getShortHash = async (cwd: string, hash: string) => {
  const result = await gitExec(['rev-parse', '--short', hash], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : hash.slice(0, 7);
};

export default getShortHash;

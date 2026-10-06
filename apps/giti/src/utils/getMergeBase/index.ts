import gitExec from '../gitExec';

const getMergeBase = async (cwd: string, a: string, b: string) => {
  const result = await gitExec(['merge-base', a, b], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : null;
};

export default getMergeBase;

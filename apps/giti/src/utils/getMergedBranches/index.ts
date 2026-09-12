import gitExec from '../gitExec';

const getMergedBranches = async (cwd: string, targetBranch = 'HEAD') => {
  const result = await gitExec(
    ['branch', '--merged', targetBranch, '--format=%(refname:short)'],
    cwd,
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((b) => b.trim());
};

export default getMergedBranches;

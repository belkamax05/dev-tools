import gitExec from '../gitExec';

const getUpstreamStats = async (cwd: string) => {
  const result = await gitExec(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], cwd);
  if (result.exitCode !== 0) return { ahead: 0, behind: 0 };
  const parts = result.stdout.split(/\s+/).map(Number);
  return { ahead: parts[0] || 0, behind: parts[1] || 0 };
};

export default getUpstreamStats;

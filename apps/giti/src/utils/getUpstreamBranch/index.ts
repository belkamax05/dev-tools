import gitExec from '../gitExec';

const getUpstreamBranch = async (cwd: string) => {
  const result = await gitExec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  if (result.exitCode !== 0 || !result.stdout) return '';
  const slashIdx = result.stdout.indexOf('/');
  return slashIdx === -1 ? result.stdout : result.stdout.slice(slashIdx + 1);
};

export default getUpstreamBranch;

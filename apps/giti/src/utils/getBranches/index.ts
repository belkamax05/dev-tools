import gitExec from '../gitExec';

const getBranches = async (cwd: string) => {
  const localResult = await gitExec(['branch', '--format=%(refname:short)'], cwd);
  const remoteResult = await gitExec(['branch', '-r', '--format=%(refname:short)'], cwd);

  const local =
    localResult.exitCode === 0
      ? localResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((b) => b.trim())
      : [];
  const remote =
    remoteResult.exitCode === 0
      ? remoteResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((b) => b.trim())
      : [];

  return { local, remote };
};

export default getBranches;

import gitExec from '../gitExec';

const getCommitSubject = async (cwd: string, ref: string) => {
  const result = await gitExec(['log', '-1', '--format=%s', ref], cwd);
  return result.exitCode === 0 ? result.stdout.trim() : '';
};

export default getCommitSubject;

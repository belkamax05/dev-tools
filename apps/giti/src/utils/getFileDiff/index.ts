import GitError from '../../types/GitError';
import gitExec from '../gitExec';

const getFileDiff = async (cwd: string, file: string, staged: boolean) => {
  const args = ['diff'];
  if (staged) args.push('--cached');
  args.push(file);

  const result = await gitExec(args, cwd);
  if (result.exitCode !== 0) throw new GitError(result);
  return result.stdout;
};

export default getFileDiff;

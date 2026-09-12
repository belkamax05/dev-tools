import GitError from '../../types/GitError';
import getBranch from '../getBranch';
import gitExec from '../gitExec';

const getDiff = async (cwd: string, targetBranch: string, baseBranch?: string) => {
  const current = baseBranch || (await getBranch(cwd));
  //? targetBranch..current shows changes FROM target INTO current (what current branch changed)
  const result = await gitExec(['diff', `${targetBranch}..${current}`], cwd);
  if (result.exitCode !== 0) throw new GitError(result);
  return result.stdout;
};

export default getDiff;

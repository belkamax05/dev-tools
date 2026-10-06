import GitError from '../../types/GitError';
import gitExec from '../gitExec';
import isDirty from '../isDirty';

const getCurrentCommit = async (
  cwd: string,
  options: { short?: boolean; includeDirty?: boolean } = { short: true, includeDirty: false },
) => {
  const args = ['rev-parse', 'HEAD'];
  if (options.short !== false) args.splice(1, 0, '--short');

  const result = await gitExec(args, cwd);
  if (result.exitCode !== 0) {
    throw new GitError(result);
  }

  let hash = result.stdout;
  if (options.includeDirty && (await isDirty(cwd))) {
    hash += '-dirty';
  }

  return hash;
};

export default getCurrentCommit;

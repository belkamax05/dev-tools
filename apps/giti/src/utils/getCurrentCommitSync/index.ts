import GitError from '../../types/GitError';
import gitExecSync from '../gitExecSync';
import isDirtySync from '../isDirtySync';

/**
 * Get the current commit hash synchronously
 * @param cwd - Repository root path
 * @param options - Options for hash format
 * @param options.short - Return short hash (default: true)
 * @param options.includeDirty - Append "-dirty" if repo is dirty (default: false)
 * @returns Commit hash
 * @example
 * const hash = getCurrentCommitSync('/path/to/repo', { short: true, includeDirty: true });
 */
const getCurrentCommitSync = (
  cwd: string,
  options: { short?: boolean; includeDirty?: boolean } = { short: true, includeDirty: false },
): string => {
  const args = ['rev-parse', 'HEAD'];
  if (options.short !== false) args.splice(1, 0, '--short');

  const result = gitExecSync(args, cwd);
  if (result.exitCode !== 0) {
    throw new GitError(result);
  }

  let hash = result.stdout;
  if (options.includeDirty && isDirtySync(cwd)) {
    hash += '-dirty';
  }

  return hash;
};

export default getCurrentCommitSync;

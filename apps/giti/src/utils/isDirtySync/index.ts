import gitExecSync from '../gitExecSync';

/**
 * Check if the repository has uncommitted changes (dirty state) synchronously
 * @param cwd - Repository root path
 * @returns True if dirty
 * @example
 * const dirty = isDirtySync('/path/to/repo');
 */
const isDirtySync = (cwd: string): boolean => {
  try {
    const result = gitExecSync(['diff-index', '--quiet', 'HEAD', '--'], cwd);
    return result.exitCode !== 0;
  } catch {
    return false;
  }
};

export default isDirtySync;

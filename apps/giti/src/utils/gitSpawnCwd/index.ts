import { resolve } from 'node:path';

/**
 * Validate the repository path a git command must run in.
 * @param cwd - Repository path supplied by the caller
 * @returns Absolute repository path
 * @throws When `cwd` is empty — an empty/undefined `cwd` makes the child process inherit
 * `process.cwd()`, which silently reads the current folder's repository instead of the
 * caller's.
 */
const gitSpawnCwd = (cwd: string): string => {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new Error(
      'git command requires an explicit repository path; received an empty cwd (this would fall back to the current folder).',
    );
  }
  return resolve(cwd);
};

export default gitSpawnCwd;

import type GitResult from './GitResult';

export default class GitError extends Error {
  constructor(public result: GitResult) {
    super(`Git command failed with exit code ${result.exitCode}: ${result.stderr}`);
  }
}

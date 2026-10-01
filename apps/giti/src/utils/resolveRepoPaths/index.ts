import { realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import GitError from '../../types/GitError';
import gitExec from '../gitExec';

/**
 * Paths the user typed, rewritten relative to the repository's top level — the form
 * `git status --porcelain` prints — plus that top level to run git from.
 *
 * Typed paths are relative to the folder the command was typed in. Under a `!` alias git has
 * already chdir'd to the top level and left the original subfolder in `GIT_PREFIX`, so that is
 * joined back on first (`prefix`, defaulting to the env var). Without it `giti stage x.ts` from a
 * subfolder would look for `x.ts` at the root.
 *
 * @throws GitError when `cwd` is not inside a repository.
 */
const resolveRepoPaths = async (
  cwd: string,
  paths: string[],
  prefix = process.env.GIT_PREFIX ?? '',
) => {
  //? Real path, because git reports the top level resolved — a symlinked folder on one side only
  //? would turn every path into a `../..` walk
  const typedIn = realpathSync(join(cwd, prefix));
  const top = await gitExec(['rev-parse', '--show-toplevel'], typedIn);
  if (top.exitCode !== 0) throw new GitError(top);
  const root = realpathSync(top.stdout.trim());
  return {
    root,
    //? git always prints forward slashes whatever the platform separator is, and the root
    //? itself is `.` — an empty pathspec is an error to git
    paths: paths.map((path) => relative(root, resolve(typedIn, path)).split(sep).join('/') || '.'),
  };
};

export default resolveRepoPaths;

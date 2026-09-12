import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import GitError from '../../types/GitError';
import getStatus from '../getStatus';
import gitExec from '../gitExec';
import parsePorcelainStatus from '../parsePorcelainStatus';

const isPatch = (path: string) => path.endsWith('.patch');

/**
 * Resets the working tree to match HEAD by cancelling all changes:
 * staged, unstaged, AND untracked files — except *.patch files which are preserved.
 *
 * This is the "cancel" counterpart of the patch-based stash workflow:
 *   patch-save  → git diff HEAD → saves all tracked changes to a .patch file
 *   cancel-all  → reverts everything to HEAD (this function)
 *   patch-apply → git apply → re-creates changes as unstaged working-tree edits
 *
 * Strategy per file category:
 *  - Newly added (index='A'): unstage via `git restore --staged`, then delete from
 *    the working tree. These files didn't exist in HEAD.
 *  - All other staged files (M/D/R/C): `git checkout HEAD -- <file>` resets both the
 *    index entry and the working-tree copy in one step.
 *  - Working-tree-only modifications (not staged): `git checkout HEAD -- <file>`.
 *  - Untracked files: deleted from the working tree. They don't exist in HEAD and
 *    would cause `git apply` to fail with "already exists" if a patch re-creates them.
 *
 * Returns counts of what was cleaned up for caller logging.
 */
const cancelAllChanges = async (cwd: string) => {
  const raw = await getStatus(cwd);
  const { staged, modified, untracked } = parsePorcelainStatus(raw);

  //? Newly added files that have no HEAD counterpart — unstage then delete
  const newlyAdded = staged.filter((e) => e.index === 'A' && !isPatch(e.path)).map((e) => e.path);

  //? Existing tracked staged files — wipe both index and working tree
  const stagedExisting = staged
    .filter((e) => e.index !== 'A' && !isPatch(e.path))
    .map((e) => e.path);

  //? Working-tree-only changes not already covered by stagedExisting
  const stagedPaths = new Set(staged.map((e) => e.path));
  const modifiedOnly = modified
    .filter((e) => !isPatch(e.path) && !stagedPaths.has(e.path))
    .map((e) => e.path);

  //? Untracked files that are not patches — delete from working tree
  const untrackedToDelete = untracked.filter((e) => !isPatch(e.path)).map((e) => e.path);

  if (newlyAdded.length > 0) {
    const result = await gitExec(['restore', '--staged', ...newlyAdded], cwd);
    if (result.exitCode !== 0) throw new GitError(result);
  }

  //? Delete newly-added (now unstaged) + untracked files from working tree
  for (const file of [...newlyAdded, ...untrackedToDelete]) {
    try {
      unlinkSync(join(cwd, file));
    } catch {
      //? File may already be gone; safe to ignore
    }
  }

  const toRestore = [...stagedExisting, ...modifiedOnly];
  if (toRestore.length > 0) {
    const result = await gitExec(['checkout', 'HEAD', '--', ...toRestore], cwd);
    if (result.exitCode !== 0) throw new GitError(result);
  }

  return {
    newlyAdded: newlyAdded.length,
    staged: stagedExisting.length,
    modified: modifiedOnly.length,
    untracked: untrackedToDelete.length,
  };
};

export default cancelAllChanges;

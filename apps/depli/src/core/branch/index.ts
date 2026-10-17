import exec from '@/dev-tools/utils/process/exec';

import { expandHome } from '../../config/project';

/** The branch checked out in `repoPath`, or undefined (detached HEAD, not a repository). */
export const currentBranch = async (repoPath: string): Promise<string | undefined> => {
  const result = await exec(['git', '-C', expandHome(repoPath), 'branch', '--show-current']);
  return result.exitCode === 0 && result.stdout ? result.stdout.trim() : undefined;
};

/**
 * The branch the app works on. A pick is kept only while the checkout stays on the branch it was
 * made on: switch branches in the repository and the pick is dropped, the new current branch
 * preselected.
 */
export interface BranchSelection {
  selected?: string;
  /** The checkout's branch when `selected` was picked. */
  pickedWhileOn?: string;
}

export const resolveSelection = (
  saved: BranchSelection,
  current: string | undefined,
): { branch: string | undefined; selection: BranchSelection; reset: boolean } => {
  if (saved.selected && saved.pickedWhileOn === current)
    return { branch: saved.selected, selection: saved, reset: false };
  const reset = Boolean(saved.selected && saved.pickedWhileOn !== current);
  return { branch: current, selection: { selected: current, pickedWhileOn: current }, reset };
};

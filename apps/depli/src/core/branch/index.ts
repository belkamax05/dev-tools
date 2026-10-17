import exec from '@/dev-tools/utils/process/exec';

import { type BranchRecentRule, expandHome } from '../../config/project';
import { type BranchHead, matchesPatterns } from '../plugin';

/** The branch checked out in `repoPath`, or undefined (detached HEAD, not a repository). */
export const currentBranch = async (repoPath: string): Promise<string | undefined> => {
  const result = await exec(['git', '-C', expandHome(repoPath), 'branch', '--show-current']);
  return result.exitCode === 0 && result.stdout ? result.stdout.trim() : undefined;
};

/**
 * The branch the app works on: the saved pick, kept until another is picked. The checkout's own
 * branch plays no part — with nothing picked yet, the app starts on the newest branch the
 * provider lists (`pickRecentBranches`).
 */
export interface BranchSelection {
  selected?: string;
  /** The checkout's branch when `selected` was picked. */
  pickedWhileOn?: string;
}

export const resolveSelection = (
  saved: BranchSelection,
): { branch: string | undefined; selection: BranchSelection } => ({
  branch: saved.selected,
  selection: saved,
});

const newestFirst = (a: BranchHead, b: BranchHead) =>
  (b.committedAt ?? '').localeCompare(a.committedAt ?? '');

/**
 * The provider's branches worth showing, newest commit first: the `required` ones always (when
 * they exist), the newest `count` of each `atLeast` group, then the newest of the rest until
 * `limit` — the rule's own picks may take the list past it, never the filler.
 */
export const pickRecentBranches = (
  heads: readonly BranchHead[],
  rule: BranchRecentRule,
): BranchHead[] => {
  const sorted = [...heads].sort(newestFirst);
  const chosen = new Map<string, BranchHead>();
  for (const name of rule.required ?? []) {
    const head = sorted.find((item) => item.name === name);
    if (head) chosen.set(head.name, head);
  }
  for (const group of rule.atLeast ?? []) {
    let taken = 0;
    for (const head of sorted) {
      if (taken >= group.count) break;
      if (!matchesPatterns(head.name, group.patterns)) continue;
      taken += 1;
      chosen.set(head.name, head);
    }
  }
  const limit = rule.limit ?? 12;
  for (const head of sorted) {
    if (chosen.size >= limit) break;
    chosen.set(head.name, head);
  }
  return [...chosen.values()].sort(newestFirst);
};

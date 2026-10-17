import exec from '@/dev-tools/utils/process/exec';

import { expandHome } from '../../config/project';
import type { BranchHead } from '../plugin';

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

/**
 * The checkout's local branches, newest commit first — the ones someone is working on, which a
 * remote's watch list does not know about. Undefined when `repoPath` is not a repository.
 */
export const localBranches = async (repoPath: string): Promise<BranchHead[] | undefined> => {
  const result = await exec([
    'git',
    '-C',
    expandHome(repoPath),
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(objectname)%09%(committerdate:iso-strict)%09%(subject)',
    'refs/heads',
  ]);
  if (result.exitCode !== 0) return undefined;
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', sha = '', committedAt, ...subject] = line.split('\t');
      return { name, sha, committedAt, message: subject.join('\t') || undefined };
    });
};

/**
 * The branch list in the order it is read: the checked-out branch, the other local branches,
 * then the provider's (watched, or all) — each branch once, its provider entry preferred (it is
 * what deploys) and marked when it exists only locally.
 */
export const orderBranches = (
  current: string | undefined,
  local: readonly BranchHead[],
  remote: readonly BranchHead[],
  /** Every branch the provider has (not only the shown ones) — unknown while not read yet. */
  pushed?: ReadonlyMap<string, BranchHead>,
): Array<BranchHead & { section: 'current' | 'local' | 'remote'; localOnly: boolean }> => {
  const known = pushed ?? new Map(remote.map((head) => [head.name, head]));
  const seen = new Set<string>();
  const out: Array<BranchHead & { section: 'current' | 'local' | 'remote'; localOnly: boolean }> =
    [];
  const add = (head: BranchHead, section: 'current' | 'local' | 'remote') => {
    if (seen.has(head.name)) return;
    seen.add(head.name);
    const onRemote = known.get(head.name);
    out.push({
      ...(onRemote ?? head),
      section,
      localOnly: section !== 'remote' && pushed !== undefined && !onRemote,
    });
  };
  const currentHead = local.find((head) => head.name === current);
  if (currentHead) add(currentHead, 'current');
  for (const head of local) add(head, 'local');
  for (const head of remote) add(head, 'remote');
  return out;
};

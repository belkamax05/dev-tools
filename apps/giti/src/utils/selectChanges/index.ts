import parsePorcelainStatus from '../parsePorcelainStatus';

/** What happened to a file, as the stage/unstage filters name it. */
export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export const CHANGE_KINDS: readonly ChangeKind[] = [
  'modified',
  'added',
  'deleted',
  'renamed',
  'untracked',
];

/** Which column of `git status --porcelain` to read: the index (staged) or the work tree. */
export type ChangeSide = 'staged' | 'unstaged';

const KIND_BY_CODE: Record<string, ChangeKind> = {
  M: 'modified',
  T: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
};

/**
 * Paths from `git status --porcelain` output on one side of the index, filtered by kind.
 *
 * An empty `kinds` means every kind. A rename yields both its new and its old path. Untracked files only ever appear on the unstaged side, and
 * conflicted ones on neither — resolving a conflict is not a bulk operation.
 */
const selectChanges = (raw: string, side: ChangeSide, kinds: readonly ChangeKind[] = []) => {
  const wanted = new Set(kinds.length ? kinds : CHANGE_KINDS);
  const { staged, modified, untracked } = parsePorcelainStatus(raw);

  const tracked = (side === 'staged' ? staged : modified).filter((entry) => {
    const code = side === 'staged' ? entry.index : entry.work;
    const kind = KIND_BY_CODE[code];
    return kind !== undefined && wanted.has(kind);
  });
  //? A rename is a delete of the old path plus an add of the new one; acting on the new path
  //? alone would leave the delete behind on the other side of the index
  const paths = tracked.flatMap((entry) =>
    entry.origPath ? [entry.path, entry.origPath] : [entry.path],
  );
  if (side === 'unstaged' && wanted.has('untracked')) paths.push(...untracked.map((e) => e.path));
  return paths;
};

export default selectChanges;

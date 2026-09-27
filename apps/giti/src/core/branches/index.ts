import git, { failure } from '../run';
import type { OperationResult } from '../status';

export interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  /** The branch it tracks, `origin/main`, or ''. */
  upstream: string;
  ahead: number;
  behind: number;
  /** The upstream was deleted on the remote. */
  gone: boolean;
  /** Already contained in HEAD, so deleting it loses nothing. */
  merged: boolean;
  subject: string;
  when: string;
  /** Tip's committer date, unix seconds — what "newest first" sorts on. */
  timestamp: number;
}

export type BranchSort = 'time' | 'name';

const SEP = '\u001f';

const parseTrack = (track: string) => ({
  ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
  behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
  gone: track.includes('gone'),
});

/** Every local and remote-tracking branch, with what each tracks and how far apart they are. */
export const getBranches = async (root: string): Promise<Branch[]> => {
  const format = [
    '%(refname)',
    '%(refname:short)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(HEAD)',
    '%(contents:subject)',
    '%(committerdate:relative)',
    '%(committerdate:unix)',
  ].join(SEP);
  const [refs, merged] = await Promise.all([
    git(['for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes'], root),
    git(['branch', '--merged', 'HEAD', '--format=%(refname:short)'], root),
  ]);
  const mergedSet = new Set(merged.stdout.split('\n').filter(Boolean));
  return (
    refs.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [
          ref = '',
          name = '',
          upstream = '',
          track = '',
          head = '',
          subject = '',
          when = '',
          unix = '',
        ] = line.split(SEP);
        const isRemote = ref.startsWith('refs/remotes/');
        const isCurrent = head === '*';
        return {
          name,
          isRemote,
          isCurrent,
          upstream,
          ...parseTrack(track),
          merged: !isRemote && !isCurrent && mergedSet.has(name),
          subject,
          when,
          timestamp: Number(unix) || 0,
        };
      })
      //? `origin/HEAD` is a pointer, not a branch anyone works on
      .filter((branch) => !(branch.isRemote && branch.name.endsWith('/HEAD')))
  );
};

/**
 * The checked-out branch first, then the rest newest-first or by name. Pure,
 * so the view can re-sort on a toggle without asking git again.
 */
export const sortBranches = (branches: Branch[], sort: BranchSort): Branch[] =>
  [...branches].sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      (sort === 'time' ? b.timestamp - a.timestamp : 0) ||
      a.name.localeCompare(b.name),
  );

/**
 * Merge a branch into the checked-out one. `--no-edit` keeps git's default
 * message — an editor here would hang the TUI. A conflict leaves the merge in
 * progress, which the dashboard's operation banner picks up (continue/abort).
 */
export const mergeBranch = async (root: string, branch: Branch): Promise<OperationResult> => {
  if (branch.isCurrent) return { ok: false, message: 'A branch cannot be merged into itself' };
  const result = await git(['merge', '--no-edit', branch.name], root);
  return result.ok
    ? { ok: true, message: `Merged ${branch.name}` }
    : { ok: false, message: failure(result, 'merge stopped') };
};

/**
 * Switch to a branch. A remote-tracking one is switched to through a local
 * branch that tracks it — created if there is none yet — which is what
 * `git switch` does when given the short name.
 */
export const switchBranch = async (root: string, branch: Branch): Promise<OperationResult> => {
  const local = branch.isRemote ? branch.name.replace(/^[^/]+\//, '') : branch.name;
  const result = await git(['switch', local], root);
  return result.ok
    ? { ok: true, message: `Switched to ${local}` }
    : { ok: false, message: failure(result, 'git switch failed') };
};

export const createBranch = async (
  root: string,
  name: string,
  startPoint?: string,
): Promise<OperationResult> => {
  if (!name.trim()) return { ok: false, message: 'A branch needs a name' };
  const result = await git(
    ['switch', '-c', name.trim(), ...(startPoint ? [startPoint] : [])],
    root,
  );
  return result.ok
    ? { ok: true, message: `Created and switched to ${name.trim()}` }
    : { ok: false, message: failure(result, 'could not create the branch') };
};

export const renameBranch = async (
  root: string,
  from: string,
  to: string,
): Promise<OperationResult> => {
  if (!to.trim()) return { ok: false, message: 'A branch needs a name' };
  const result = await git(['branch', '-m', from, to.trim()], root);
  return result.ok
    ? { ok: true, message: `Renamed ${from} to ${to.trim()}` }
    : { ok: false, message: failure(result, 'could not rename the branch') };
};

/**
 * Delete a local branch — only one already merged into HEAD. `git branch -d`
 * refuses anything else, and there is deliberately no `-D` here: throwing away
 * unmerged commits from a list is too easy to do by accident.
 */
export const deleteBranch = async (root: string, branch: Branch): Promise<OperationResult> => {
  if (branch.isRemote) return { ok: false, message: 'Remote branches are not deleted from here' };
  if (branch.isCurrent) return { ok: false, message: 'Switch to another branch first' };
  if (!branch.merged)
    return { ok: false, message: `${branch.name} has commits HEAD does not — merge it first` };
  const result = await git(['branch', '-d', branch.name], root);
  return result.ok
    ? { ok: true, message: `Deleted ${branch.name}` }
    : { ok: false, message: failure(result, 'could not delete the branch') };
};

export const setUpstream = async (
  root: string,
  branch: string,
  upstream: string,
): Promise<OperationResult> => {
  const result = await git(['branch', `--set-upstream-to=${upstream}`, branch], root);
  return result.ok
    ? { ok: true, message: `${branch} now tracks ${upstream}` }
    : { ok: false, message: failure(result, 'could not set the upstream') };
};

/** What a branch has that the current one does not, as a diff of the two tips' merge base. */
export const compareWithCurrent = async (root: string, branch: string): Promise<string> =>
  (await git(['diff', '--stat', '--patch', '--no-color', `HEAD...${branch}`], root)).stdout;

export default getBranches;

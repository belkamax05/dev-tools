import type { RemoteDetail } from '../../types/RemoteDetail';
import type { UserIdentity } from '../../types/UserIdentity';
import getBranches from '../getBranches';
import getCurrentUser from '../getCurrentUser';
import getMergedBranches from '../getMergedBranches';
import getRemoteDetails from '../getRemoteDetails';
import getStashCount from '../getStashCount';
import getStatus from '../getStatus';
import getSubrepos from '../getSubrepos';
import getSubtrees from '../getSubtrees';
import getUpstreamBranch from '../getUpstreamBranch';
import getUpstreamStats from '../getUpstreamStats';
import gitExec from '../gitExec';
import parsePorcelainStatus from '../parsePorcelainStatus';
import type { Vendored } from '../vendored';

/** One file the working tree has something to say about. */
export interface SnapshotFile {
  /** Porcelain index column — what is staged. */
  index: string;
  /** Porcelain worktree column — what is not. */
  work: string;
  path: string;
  origPath: string | undefined;
}

export interface SnapshotCommit {
  short: string;
  full: string;
  author: string;
  /** Relative date as git spells it: "3 days ago". */
  rel: string;
  subject: string;
  /** Ref names decorating this commit, or '' when it carries none. */
  refs: string;
}

export interface RepoSnapshot {
  /** Absolute repository root, or '' when `cwd` is not inside a repository. */
  root: string;
  cwd: string;
  /** False when git had nothing to say about `cwd` — every other field is empty. */
  isRepo: boolean;

  branch: string;
  /** True while HEAD is detached, where `branch` reads "HEAD". */
  detached: boolean;
  headShort: string;
  headFull: string;
  /** HEAD's subject line, so the dashboard can say what you are sitting on. */
  headSubject: string;

  upstream: string;
  remote: string;
  originUrl: string;
  ahead: number;
  behind: number;

  staged: SnapshotFile[];
  modified: SnapshotFile[];
  untracked: SnapshotFile[];
  conflicted: SnapshotFile[];
  stashCount: number;

  user: UserIdentity;
  commits: SnapshotCommit[];
  localBranches: string[];
  remoteBranches: string[];
  /** Local branches already contained in HEAD — the ones safe to delete. */
  mergedBranches: string[];
  remotes: RemoteDetail[];
  vendored: Vendored[];

  /** When this was taken, for the "as of" line a held-open dashboard needs. */
  takenAt: number;
}

/** How many commits the log view is given to scroll through. */
const LOG_LIMIT = 200;

/**
 * Field separator for the log format — ASCII Unit Separator.
 *
 * Written as a character code rather than as a literal for the same reason
 * `dev-tools`'s `ESC` is: a control byte sitting in a source file is
 * invisible in every editor and diff, and is silently eaten by any tool that
 * strips control characters. A commit subject cannot contain one, which is the
 * whole reason to prefer it over the `|` the older status command splits on.
 */
const FIELD = String.fromCharCode(0x1f);

const emptySnapshot = (cwd: string, user: UserIdentity): RepoSnapshot => ({
  root: '',
  cwd,
  isRepo: false,
  branch: '',
  detached: false,
  headShort: '',
  headFull: '',
  headSubject: '',
  upstream: '',
  remote: '',
  originUrl: '',
  ahead: 0,
  behind: 0,
  staged: [],
  modified: [],
  untracked: [],
  conflicted: [],
  stashCount: 0,
  user,
  commits: [],
  localBranches: [],
  remoteBranches: [],
  mergedBranches: [],
  remotes: [],
  vendored: [],
  takenAt: Date.now(),
});

/**
 * Everything the dashboard draws, read in one pass.
 *
 * Gathered here rather than per view so a refresh is one round of git commands
 * instead of seven, and so every panel on screen is describing the same instant
 * — a status pane read at one moment beside a log read at another will
 * eventually disagree with itself, and the reader has no way to tell which half
 * is stale.
 *
 * Nothing here throws. A dashboard is a thing you leave open, and a repository
 * with no upstream, no remotes, or no commits at all is an ordinary state to be
 * in rather than an error to report — each of those simply reads as empty.
 *
 * ! Read-only by construction: every command below either inspects refs or reads
 * ! the index, and none of them contacts a remote. Opening the dashboard must
 * ! never be a thing that changes the repository or blocks on the network.
 *
 * @param cwd - Any directory; one outside a repository comes back `isRepo: false`
 * @returns One consistent reading of the repository
 * @example
 * const snapshot = await getRepoSnapshot(getWorkingDir());
 */
const getRepoSnapshot = async (cwd: string): Promise<RepoSnapshot> => {
  const user = await getCurrentUser(cwd).catch(
    (): UserIdentity => ({ email: '', name: '', id: 'unknown', isValid: false }),
  );

  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd).catch(() => null);
  if (!rootResult || rootResult.exitCode !== 0 || !rootResult.stdout.trim()) {
    return emptySnapshot(cwd, user);
  }
  const root = rootResult.stdout.trim();

  //? `%D` gives the decoration without its surrounding parentheses, so a commit
  //? that carries no refs comes back as the empty string the views test against.
  const logFormat = ['%h', '%H', '%an', '%ar', '%s', '%D'].join(FIELD);

  const [
    branchResult,
    headResult,
    upstream,
    stats,
    porcelain,
    logResult,
    stashCount,
    branches,
    mergedBranches,
    remotes,
    originResult,
    subrepos,
    subtrees,
  ] = await Promise.all([
    gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], root),
    gitExec(['rev-parse', 'HEAD'], root),
    getUpstreamBranch(root).catch(() => ''),
    getUpstreamStats(root).catch(() => ({ ahead: 0, behind: 0 })),
    getStatus(root).catch(() => ''),
    gitExec(['log', `-${LOG_LIMIT}`, `--format=${logFormat}`], root),
    getStashCount(root).catch(() => 0),
    getBranches(root).catch(() => ({ local: [] as string[], remote: [] as string[] })),
    getMergedBranches(root).catch((): string[] => []),
    getRemoteDetails(root).catch((): RemoteDetail[] => []),
    gitExec(['remote', 'get-url', 'origin'], root),
    getSubrepos(root).catch((): Vendored[] => []),
    getSubtrees(root).catch((): Vendored[] => []),
  ]);

  const { staged, modified, untracked, conflicted } = parsePorcelainStatus(porcelain);

  const commits: SnapshotCommit[] =
    logResult.exitCode === 0 && logResult.stdout
      ? logResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [short = '', full = '', author = '', rel = '', subject = '', refs = ''] =
              line.split(FIELD);
            return { short, full, author, rel, subject, refs };
          })
      : [];

  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : '';
  const headFull = headResult.exitCode === 0 ? headResult.stdout.trim() : '';
  const head = commits[0];

  return {
    root,
    cwd,
    isRepo: true,
    branch,
    //? git spells a detached HEAD as the literal "HEAD" here. That is also a
    //? legal branch name, but not one anybody has, and the alternative
    //? (`symbolic-ref -q HEAD`) is another round trip for the same answer.
    detached: branch === 'HEAD',
    headShort: head?.short ?? headFull.slice(0, 7),
    headFull,
    headSubject: head?.subject ?? '',
    upstream,
    remote: remotes[0]?.name ?? '',
    originUrl: originResult.exitCode === 0 ? originResult.stdout.trim() : '',
    ahead: stats.ahead,
    behind: stats.behind,
    staged,
    modified,
    untracked,
    conflicted,
    stashCount,
    user,
    commits,
    localBranches: branches.local,
    remoteBranches: branches.remote,
    mergedBranches,
    remotes,
    //? Subrepos first: where a directory is claimed by both, the live `.gitrepo`
    //? declaration is the current truth and the subtree trailers are history
    //? that cannot un-say itself. See `getSubtrees`.
    vendored: [...subrepos, ...subtrees],
    takenAt: Date.now(),
  };
};

export default getRepoSnapshot;

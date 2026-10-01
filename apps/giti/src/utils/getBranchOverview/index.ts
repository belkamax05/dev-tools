import gitExec from '../gitExec';
import GitError from '../../types/GitError';

export interface Divergence {
  /** Commits on the branch that the base does not have. */
  ahead: number;
  /** Commits on the base that the branch does not have. */
  behind: number;
}

export interface BranchOverviewRow {
  name: string;
  /** What git resolves: the local branch, or `<remote>/<name>` when it only exists remotely. */
  ref: string;
  isCurrent: boolean;
  isBase: boolean;
  isRemoteOnly: boolean;
  shortHash: string;
  subject: string;
  author: string;
  /** Unix seconds of the tip's commit date. */
  timestamp: number;
  /** Standing against each base branch, keyed by base name; a base never lists itself. */
  divergence: Record<string, Divergence>;
  /** Bases whose history already contains this branch's tip. */
  mergedInto: string[];
}

export interface BranchOverview {
  rows: BranchOverviewRow[];
  /** Bases that resolved to a ref and so were compared against. */
  bases: string[];
  /** Bases that were asked for but exist neither locally nor on the remote. */
  missingBases: string[];
}

interface BranchOverviewOptions {
  remote?: string;
  /** Leave out branches that exist only on the remote. */
  localOnly?: boolean;
}

interface RefTip {
  refname: string;
  shortHash: string;
  timestamp: number;
  author: string;
  subject: string;
}

const SEP = '\x1f';

const listRefs = async (cwd: string, patterns: string[], merged?: string): Promise<RefTip[]> => {
  const result = await gitExec(
    [
      'for-each-ref',
      ...(merged ? [`--merged=${merged}`] : []),
      `--format=${['%(refname)', '%(objectname:short)', '%(committerdate:unix)', '%(authorname)', '%(subject)'].join(SEP)}`,
      ...patterns,
    ],
    cwd,
  );
  if (result.exitCode !== 0) throw new GitError(result);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [refname = '', shortHash = '', unix = '', author = '', subject = ''] = line.split(SEP);
      return { refname, shortHash, timestamp: Number(unix) || 0, author, subject };
    });
};

const countDivergence = async (cwd: string, base: string, ref: string): Promise<Divergence> => {
  const result = await gitExec(['rev-list', '--left-right', '--count', `${base}...${ref}`], cwd);
  if (result.exitCode !== 0) return { ahead: 0, behind: 0 };
  const [behind = 0, ahead = 0] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
};

/**
 * Every branch of the repository measured against a set of base branches: how far ahead and
 * behind each one is, whether a base already contains it, and how old its tip is.
 *
 * Local branches win over their remote twin; a branch that only exists on `remote` is listed
 * from there unless `localOnly` is set. Offline — it reads whatever the last fetch left behind.
 */
const getBranchOverview = async (
  cwd: string,
  bases: string[],
  { remote = 'origin', localOnly = false }: BranchOverviewOptions = {},
): Promise<BranchOverview> => {
  const localPrefix = 'refs/heads/';
  const remotePrefix = `refs/remotes/${remote}/`;
  const patterns = localOnly ? [localPrefix] : [localPrefix, remotePrefix];

  const [tips, headResult] = await Promise.all([
    listRefs(cwd, patterns),
    gitExec(['symbolic-ref', '-q', '--short', 'HEAD'], cwd),
  ]);
  const current = headResult.exitCode === 0 ? headResult.stdout.trim() : '';

  //? name → tip, local first so a remote twin never replaces it
  const byName = new Map<string, RefTip & { ref: string; isRemoteOnly: boolean }>();
  for (const tip of tips) {
    if (tip.refname.startsWith(localPrefix)) {
      const name = tip.refname.slice(localPrefix.length);
      byName.set(name, { ...tip, ref: name, isRemoteOnly: false });
    }
  }
  for (const tip of tips) {
    if (!tip.refname.startsWith(remotePrefix)) continue;
    const name = tip.refname.slice(remotePrefix.length);
    //? `<remote>/HEAD` is a pointer to another branch, not a branch of its own
    if (name === 'HEAD' || byName.has(name)) continue;
    byName.set(name, { ...tip, ref: `${remote}/${name}`, isRemoteOnly: true });
  }

  //? A base the user named may only exist on the remote even when remote branches are hidden
  const resolveBase = async (base: string) => {
    const known = byName.get(base);
    if (known) return known.ref;
    const remoteRef = `${remote}/${base}`;
    const check = await gitExec(['rev-parse', '--verify', '-q', `refs/remotes/${remoteRef}`], cwd);
    return check.exitCode === 0 ? remoteRef : '';
  };
  const resolved = await Promise.all(
    bases.map(async (base) => ({ base, ref: await resolveBase(base) })),
  );
  const found = resolved.filter((entry) => entry.ref);
  const missingBases = resolved.filter((entry) => !entry.ref).map((entry) => entry.base);

  //? One `--merged` listing per base answers "is it merged" for every branch at once
  const mergedSets = await Promise.all(
    found.map(
      async ({ ref }) => new Set((await listRefs(cwd, patterns, ref)).map((t) => t.refname)),
    ),
  );

  const rows = await Promise.all(
    [...byName.entries()].map(async ([name, tip]): Promise<BranchOverviewRow> => {
      const others = found.filter((entry) => entry.base !== name);
      const divergence = Object.fromEntries(
        await Promise.all(
          others.map(
            async ({ base, ref }) => [base, await countDivergence(cwd, ref, tip.ref)] as const,
          ),
        ),
      );
      const mergedInto = found
        .filter((entry, index) => entry.base !== name && mergedSets[index]?.has(tip.refname))
        .map((entry) => entry.base);
      return {
        name,
        ref: tip.ref,
        isCurrent: name === current,
        isBase: bases.includes(name),
        isRemoteOnly: tip.isRemoteOnly,
        shortHash: tip.shortHash,
        subject: tip.subject,
        author: tip.author,
        timestamp: tip.timestamp,
        divergence,
        mergedInto,
      };
    }),
  );

  //? Bases first in the order given, then the checked-out branch, then newest activity first
  const baseOrder = (row: BranchOverviewRow) =>
    row.isBase ? bases.indexOf(row.name) : bases.length;
  rows.sort(
    (a, b) =>
      baseOrder(a) - baseOrder(b) ||
      Number(b.isCurrent) - Number(a.isCurrent) ||
      b.timestamp - a.timestamp ||
      a.name.localeCompare(b.name),
  );

  return { rows, bases: found.map((entry) => entry.base), missingBases };
};

export default getBranchOverview;

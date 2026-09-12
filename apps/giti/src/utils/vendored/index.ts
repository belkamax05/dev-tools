import gitExec from '../gitExec';

/** Which mechanism vendored a directory into the parent repository. */
export type VendorKind = 'subrepo' | 'submodule' | 'subtree';

export interface Vendored {
  kind: VendorKind;
  /** Path relative to the repository root, e.g. "libs/giti". */
  dir: string;
  /** Absolute path to the vendored directory. */
  path: string;
  /** Upstream URL, or '' when the mechanism does not record one (subtree). */
  remote: string;
  /** Upstream branch, or '' when not recorded. */
  branch: string;
  /** Upstream commit this copy is pinned to. */
  commit: string;
}

export interface VendoredState {
  vendored: Vendored;
  /** Upstream commits not yet pulled. `null` when upstream was not or could not be checked. */
  behind: number | null;
  /** Upstream tip as of this check. `null` when upstream could not be reached. */
  upstreamRef: string | null;
  /** Files this copy has that the pinned upstream commit does not. `null` when not comparable. */
  localChanges: string[] | null;
  /**
   * Commits the checked-out copy has that upstream does not — submodules only, where the copy is
   * a repository with its own history. `null` for mechanisms whose copy is just a tree.
   */
  ahead: number | null;
  /**
   * Commits the parent's recorded gitlink is behind the submodule's checkout — submodules only.
   * Non-zero means the checkout moved and the parent has not recorded the new pointer yet, which
   * is work in the parent, not in the submodule. `null` for the other mechanisms.
   */
  gitlinkBehind: number | null;
  /** Porcelain status lines for uncommitted work inside the vendored directory. */
  dirty: string[];
}

/** What one pull or push did to one entry, for the tally its caller prints at the end. */
export type VendoredOutcome = 'done' | 'current' | 'skipped' | 'failed';

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Narrow a discovered set to the directories named on the command line.
 *
 * @param all - Everything the discovery step found
 * @param dirs - Directory names from `splitVendoredArgs`, already separated from the flags
 * @returns The matching entries, or all of them when no directory was named
 */
export const selectVendored = <T extends Vendored>(all: T[], dirs: string[]): T[] => {
  if (dirs.length === 0) return all;
  return all.filter((entry) => dirs.includes(entry.dir));
};

/** Message for the two ways a selection can come back empty, kept identical across families. */
export const explainEmptySelection = (kind: VendorKind, all: Vendored[], dirs: string[]) => {
  if (all.length === 0) return `ℹ️  No ${kind}s here.`;
  return `ℹ️  No ${kind} matches ${dirs.join(', ')}. Known: ${all.map((e) => e.dir).join(', ')}`;
};

/**
 * Fetch a vendored directory's upstream branch into a ref of its own.
 *
 * @param vendored - The entry to fetch for
 * @param cwd - Directory to run git in — the parent repo, or the submodule itself
 * @param forward - Passthrough flags the user gave, e.g. `--depth=1` or `--prune`
 * @returns The upstream tip, or null when there is nothing to fetch or the fetch failed
 */
export const fetchUpstreamRef = async (vendored: Vendored, cwd: string, forward: string[] = []) => {
  const { kind, dir, remote, branch } = vendored;
  if (!remote || !branch) return null;

  //? A ref per entry rather than FETCH_HEAD, which is a single slot shared by every fetch in the
  //? repository: callers checking several directories at once would otherwise read back whichever
  //? fetch finished last and report one entry's distance for another's.
  const ref = `refs/giti/${kind}/${dir}`;
  const fetched = await gitExec(
    ['fetch', '--no-tags', '--force', ...forward, remote, `${branch}:${ref}`],
    cwd,
  );
  if (fetched.exitCode !== 0) return null;

  const head = await gitExec(['rev-parse', ref], cwd);
  return head.exitCode === 0 ? head.stdout.trim() || null : null;
};

/** Count commits on `upstreamRef` that `commit` does not contain. */
export const countBehind = async (commit: string, upstreamRef: string, cwd: string) => {
  if (!commit || !upstreamRef) return null;
  const counted = await gitExec(['rev-list', '--count', `${commit}..${upstreamRef}`], cwd);
  return counted.exitCode === 0 ? Number.parseInt(counted.stdout.trim(), 10) || 0 : null;
};

/** Porcelain lines for uncommitted work, run wherever the caller says the work lives. */
export const getDirtyPaths = async (cwd: string, pathspec?: string) => {
  const args = ['status', '--porcelain', ...(pathspec ? ['--', pathspec] : [])];
  const status = await gitExec(args, cwd);
  return status.exitCode === 0 ? status.stdout.split('\n').filter(Boolean) : [];
};

/** Names of files differing between two trees, dropping any marker file the mechanism adds. */
export const diffTreeFiles = async (
  from: string,
  to: string,
  cwd: string,
  ignore: string[] = [],
) => {
  if (!from) return null;
  const diffed = await gitExec(['diff', '--name-only', from, to], cwd);
  if (diffed.exitCode !== 0) return null;
  return diffed.stdout.split('\n').filter((file) => file && !ignore.includes(file));
};

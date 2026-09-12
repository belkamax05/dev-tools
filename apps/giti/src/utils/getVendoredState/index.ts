import type { Vendored, VendoredState } from '../vendored';
import { countBehind, diffTreeFiles, fetchUpstreamRef, getDirtyPaths } from '../vendored';
import gitExec from '../gitExec';

interface GetVendoredStateOptions {
  /** Contact the remote. Without it `behind` stays null rather than being guessed at. */
  fetch?: boolean;
  /** Passthrough flags for the fetch this makes, so the user's `--depth=`/`--prune` still apply. */
  forward?: string[];
}

/** Marker files a mechanism adds on this side, which would otherwise read as a local change. */
const MARKERS: Record<Vendored['kind'], string[]> = {
  subrepo: ['.gitrepo'],
  submodule: [],
  subtree: [],
};

/**
 * The upstream commit this copy genuinely sits on.
 *
 * Straightforward for subrepos and submodules, which both write it down. `git subtree` does not:
 * its `git-subtree-split` trailer is refreshed on every `--squash` pull but never on a plain one,
 * where upstream commits are merged into the parent's own history instead. Those two cases are
 * told apart by whether the recorded split is an ancestor of HEAD — it is exactly when the merge
 * brought it in — and for that flavour the merge base against upstream is the honest answer.
 */
const resolvePinnedCommit = async (vendored: Vendored, upstreamRef: string | null, cwd: string) => {
  const { kind, commit } = vendored;
  if (kind !== 'subtree' || !commit) return commit;

  const merged = await gitExec(['merge-base', '--is-ancestor', commit, 'HEAD'], cwd);
  //? Not an ancestor means the subtree was added or pulled with --squash, which refreshes the
  //? trailer every time, so what it records is current and can be used as-is.
  if (merged.exitCode !== 0) return commit;

  //? A plain (non-squash) subtree merges upstream commits into the parent's own history and never
  //? updates the trailer, so the recorded split is only where the directory started. The merge
  //? base against upstream is where it actually sits — and without a reachable upstream there is
  //? no way to work that out, so the answer is "unknown" rather than the stale trailer.
  if (!upstreamRef) return '';

  const base = await gitExec(['merge-base', 'HEAD', upstreamRef], cwd);
  return base.exitCode === 0 ? base.stdout.trim() || commit : commit;
};

/**
 * Work out where one vendored directory stands against its upstream.
 *
 * @param vendored - Entry from `getSubrepos`, `getSubmodules` or `getSubtrees`
 * @param cwd - Any directory inside the parent repository
 * @param options - Whether to fetch
 * @returns Counts and file lists describing what a pull or push would have to do
 */
const getVendoredState = async (
  vendored: Vendored,
  cwd: string,
  { fetch = true, forward = [] }: GetVendoredStateOptions = {},
): Promise<VendoredState> => {
  const { kind, dir, path, branch } = vendored;

  //? A submodule is a repository of its own, so its upstream, its history and its uncommitted
  //? work all live inside it — everything else is answered from the parent repo.
  const gitDir = kind === 'submodule' ? path : cwd;

  //? Submodules commonly declare no branch, and `git subtree` records none at all. Fetching
  //? `HEAD` resolves to whatever the remote calls its default branch, which is what
  //? `git submodule update --remote` would follow anyway.
  const target = kind === 'subrepo' ? vendored : { ...vendored, branch: branch || 'HEAD' };

  const upstreamRef = fetch ? await fetchUpstreamRef(target, gitDir, forward) : null;
  const pinned = await resolvePinnedCommit(vendored, upstreamRef, cwd);

  //? For a submodule "behind" is a question about the checkout, because the checkout is what a
  //? pull moves and a push sends. Measuring from the parent's gitlink instead reports a submodule
  //? that is already updated and already pushed as behind its own upstream, purely because the
  //? parent has not committed the new pointer yet — which is separate work, counted below.
  const compareFrom = kind === 'submodule' ? 'HEAD' : pinned;
  const behind = upstreamRef ? await countBehind(compareFrom, upstreamRef, gitDir) : null;

  //? How far the parent's recorded pointer trails the checkout, in commits: the honest size of
  //? that separate work, where a count of differing files only says how big the jump was.
  const gitlinkBehind = kind === 'submodule' ? await countBehind(pinned, 'HEAD', path) : null;

  const localChanges =
    kind === 'submodule'
      ? await diffTreeFiles(pinned, 'HEAD', path)
      : await diffTreeFiles(pinned, `HEAD:${dir}`, cwd, MARKERS[kind]);

  const dirty = kind === 'submodule' ? await getDirtyPaths(path) : await getDirtyPaths(cwd, dir);

  //? A submodule's copy is a repository, so "we have something upstream does not" splits in two:
  //? commits that still need pushing, and a moved checkout the parent has not recorded yet. Only
  //? the first is a push; telling them apart is what stops the advice being wrong after an update.
  const ahead =
    kind === 'submodule' && upstreamRef ? await countBehind(upstreamRef, 'HEAD', path) : null;

  return { vendored, behind, upstreamRef, localChanges, ahead, gitlinkBehind, dirty };
};

export default getVendoredState;

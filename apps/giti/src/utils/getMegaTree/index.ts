import { basename } from 'node:path';
import getOriginUrl from '../getOriginUrl';
import getSubmodules from '../getSubmodules';
import getSubrepos from '../getSubrepos';
import getSubtrees from '../getSubtrees';
import gitExec from '../gitExec';
import type { Vendored, VendorKind } from '../vendored';
import { getDirtyPaths } from '../vendored';

/** The repository every vendored directory below is vendored *into*. */
export interface MegaRepo {
  /** Absolute path to the repository root. */
  path: string;
  /** Folder name of the root — what a human calls this repo. */
  name: string;
  /** Current branch, or 'HEAD' when detached. */
  branch: string;
  /** `origin`'s URL, or '' when there is no origin. */
  remote: string;
  /** Short HEAD hash, or '' on a repository without commits. */
  commit: string;
  /** Porcelain status lines for uncommitted work anywhere in the tree. */
  dirty: string[];
}

export interface MegaGroup {
  kind: VendorKind;
  entries: Vendored[];
}

export interface MegaTree {
  repo: MegaRepo;
  /** One group per mechanism, always all three, in a stable order — empty ones included. */
  groups: MegaGroup[];
  /** How many vendored directories there are in total, across every mechanism. */
  total: number;
}

/**
 * Everything "mega" means: the repository itself plus every directory vendored into it, whichever
 * of the three mechanisms put it there.
 *
 * The per-mechanism discovery utilities each answer only their own question, so a command that
 * wants the whole picture would otherwise have to know that there are exactly three of them and in
 * which order to present them. That knowledge lives here instead.
 *
 * ! Discovery is offline for all three, so this stays as cheap as the individual `list` commands.
 *
 * @param cwd - Any directory inside the repository
 * @returns The tree, or null when `cwd` is not inside a git repository
 */
const getMegaTree = async (cwd: string): Promise<MegaTree | null> => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) return null;
  const path = rootResult.stdout.trim();

  const [branchResult, commitResult, remote, dirty, subrepos, submodules, subtrees] =
    await Promise.all([
      gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], path),
      gitExec(['rev-parse', '--short', 'HEAD'], path),
      getOriginUrl(path),
      getDirtyPaths(path),
      getSubrepos(path),
      getSubmodules(path),
      getSubtrees(path),
    ]);

  const groups: MegaGroup[] = [
    { kind: 'subrepo', entries: subrepos },
    { kind: 'submodule', entries: submodules },
    { kind: 'subtree', entries: subtrees },
  ];

  return {
    repo: {
      path,
      name: basename(path),
      //? A repository with no commits yet has no branch to name and no HEAD to resolve; both
      //? commands fail rather than returning nothing, so an empty string stands in for each.
      branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() : '',
      commit: commitResult.exitCode === 0 ? commitResult.stdout.trim() : '',
      remote,
      dirty,
    },
    groups,
    total: groups.reduce((sum, group) => sum + group.entries.length, 0),
  };
};

export default getMegaTree;

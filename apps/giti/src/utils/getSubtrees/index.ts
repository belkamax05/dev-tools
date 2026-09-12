import { dirname, join } from 'node:path';
import type { Vendored } from '../vendored';
import gitExec from '../gitExec';

/**
 * The directories some *other* mechanism claims as its own right now.
 *
 * Subtree discovery reads history, which is append-only: nothing can record that a directory
 * stopped being a subtree, only further commits saying it still is one. Subrepos and submodules
 * declare themselves in the current tree instead — `.gitrepo` for the former, a gitlink for the
 * latter — and those declarations vanish the moment the relationship does. A live declaration
 * therefore outranks history, which is what stops a directory converted from subtree to subrepo
 * from being reported as both, and which lets the reverse conversion fall back to history for
 * free once the file is gone.
 *
 * ! Matched exactly, never by prefix: a subrepo nested *inside* a genuine subtree — `system/`
 * ! holding `system/libs/foo/.gitrepo` — must not erase the subtree containing it.
 *
 * @param root - Absolute path to the repository root
 * @returns Repo-relative directories vendored by a subrepo or a submodule
 */
const getClaimedDirs = async (root: string): Promise<Set<string>> => {
  //? Read from the index rather than the filesystem, so an untracked stray `.gitrepo` cannot
  //? hide a real subtree, and so this agrees with what `getSubrepos` itself reports.
  const [gitrepos, staged] = await Promise.all([
    gitExec(['ls-files', '--full-name', '*.gitrepo'], root),
    gitExec(['ls-files', '--full-name', '-s'], root),
  ]);

  const claimed = new Set<string>();

  if (gitrepos.exitCode === 0)
    for (const file of gitrepos.stdout.split('\n').filter(Boolean)) claimed.add(dirname(file));

  if (staged.exitCode === 0)
    for (const line of staged.stdout.split('\n')) {
      //? "<mode> <sha> <stage>\t<path>" — 160000 is git's mode for a gitlink, i.e. a submodule.
      if (!line.startsWith('160000 ')) continue;
      const path = line.split('\t')[1];
      if (path) claimed.add(path);
    }

  return claimed;
};

/**
 * List the `git subtree` directories of the repository `cwd` sits in.
 *
 * Unlike subrepos and submodules, subtrees have no metadata file: `git subtree` records the
 * relationship only as trailers on the commit it creates, so discovery means reading history.
 * The newest commit mentioning a directory wins, since each later `subtree pull` adds a fresh
 * `git-subtree-split` for it.
 *
 * ! Because history cannot un-say anything, a directory that has since become a subrepo or a
 * ! submodule keeps its old trailers forever; see `getClaimedDirs` for why those win.
 *
 * ! The upstream URL is not recorded anywhere by `git subtree`, so `remote` is filled in from a
 * ! git remote whose name matches the directory's last segment, and is left empty otherwise —
 * ! callers must then ask for one explicitly.
 *
 * @param cwd - Any directory inside the repository
 * @returns One entry per subtree directory found in history, newest split first
 */
const getSubtrees = async (cwd: string): Promise<Vendored[]> => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) return [];
  const root = rootResult.stdout.trim();

  const [log, remotes, claimed] = await Promise.all([
    //? \x1e separates commits so a subject line can contain anything without confusing the split.
    gitExec(['log', '--format=%x1e%B', '--grep=^git-subtree-dir:', '--extended-regexp'], root),
    gitExec(['remote'], root),
    getClaimedDirs(root),
  ]);
  if (log.exitCode !== 0) return [];

  const remoteNames = remotes.exitCode === 0 ? remotes.stdout.split('\n').filter(Boolean) : [];

  const found = new Map<string, string>();
  for (const block of log.stdout.split('\x1e')) {
    const dir = block.match(/^git-subtree-dir:\s*(.+)$/m)?.[1]?.trim();
    const split = block.match(/^git-subtree-split:\s*(.+)$/m)?.[1]?.trim();
    //? Newest first, so the first sighting of a directory is its current split.
    if (dir && split && !found.has(dir) && !claimed.has(dir)) found.set(dir, split);
  }

  return [...found].map(([dir, commit]) => {
    const basename = dir.slice(dir.lastIndexOf('/') + 1);
    return {
      kind: 'subtree' as const,
      dir,
      path: join(root, dir),
      remote: remoteNames.includes(basename) ? basename : '',
      branch: '',
      commit,
    };
  });
};

export default getSubtrees;

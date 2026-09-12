import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import getSubmodules from '../getSubmodules';
import gitExec from '../gitExec';
import isSubrepoUsable from '../isSubrepoUsable';
import type { VendorKind } from '../vendored';

export interface VendoredCleanReport {
  kind: VendorKind;
  /** What was removed — or what would have been, under `dryRun`. */
  removed: string[];
  /** Anything worth saying even when nothing was removed. */
  notes: string[];
}

interface CleanVendoredOptions {
  /** Report what would go, remove nothing. */
  dryRun?: boolean;
  /** Passthrough flags for the one real git command here, `git subrepo clean --all`. */
  forward?: string[];
}

/** Refs `status` fetches upstreams into, one per entry so parallel checks cannot cross-read. */
const removeGitiRefs = async (kind: VendorKind, cwd: string, dryRun: boolean) => {
  const listed = await gitExec(['for-each-ref', '--format=%(refname)', `refs/giti/${kind}/`], cwd);
  const refs = listed.exitCode === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
  if (!dryRun) for (const ref of refs) await gitExec(['update-ref', '-d', ref], cwd);
  return refs;
};

/** git-subrepo's own leftovers: the refs it never collects and the worktrees it abandons. */
const cleanSubrepo = async (root: string, cwd: string, dryRun: boolean, forward: string[]) => {
  const removed: string[] = [];
  const notes: string[] = [];

  if (await isSubrepoUsable()) {
    if (!dryRun) {
      const result = await gitExec(['subrepo', 'clean', '--all', ...forward], cwd, {
        stream: true,
      });
      if (result.exitCode !== 0) notes.push('`git subrepo clean --all` reported a problem.');
    }
  } else {
    notes.push('git-subrepo is not installed — cleaning the leftovers it would have left.');
  }

  //? `git subrepo clean` removes the working branch and worktree but leaves
  //? `refs/subrepo/<dir>/{branch,commit,fetch}` behind. Those refs pin every object ever fetched
  //? for a subrepo, so they keep growing the repository silently and invisibly.
  const listed = await gitExec(['for-each-ref', '--format=%(refname)', 'refs/subrepo/'], cwd);
  const refs = listed.exitCode === 0 ? listed.stdout.split('\n').filter(Boolean) : [];
  if (!dryRun) for (const ref of refs) await gitExec(['update-ref', '-d', ref], cwd);
  removed.push(...refs);

  const tmpDir = join(root, '.git', 'tmp', 'subrepo');
  if (existsSync(tmpDir)) {
    if (!dryRun) rmSync(tmpDir, { recursive: true, force: true });
    removed.push('.git/tmp/subrepo');
  }

  return { removed, notes };
};

/**
 * Cloned history left in `.git/modules` by submodules that are no longer declared.
 *
 * Git keeps it deliberately — so a later re-add is cheap — but never collects it, and it is
 * invisible to `git status`, so it accumulates for years unnoticed.
 */
const cleanSubmodule = async (root: string, cwd: string, dryRun: boolean) => {
  const modulesDir = join(root, '.git', 'modules');
  if (!existsSync(modulesDir)) return { removed: [], notes: ['No .git/modules directory.'] };

  const declared = new Set((await getSubmodules(cwd)).map((entry) => entry.dir));

  //? Directory names under .git/modules mirror submodule names, which are their paths by
  //? default, so nested names have to be walked rather than listed one level deep.
  const walk = (dir: string, prefix = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (existsSync(join(dir, entry.name, 'HEAD'))) return [name];
      return walk(join(dir, entry.name), name);
    });

  const orphans = walk(modulesDir).filter((name) => !declared.has(name));
  if (!dryRun) {
    for (const name of orphans) rmSync(join(modulesDir, name), { recursive: true, force: true });
  }

  return {
    removed: orphans.map((name) => `.git/modules/${name}`),
    notes:
      orphans.length === 0 ? [`All ${declared.size} submodule stores are still declared.`] : [],
  };
};

/**
 * Remove what one mechanism leaves behind in `.git` after it has run.
 *
 * Nothing here touches the working tree or any vendored directory: every path removed is private
 * git bookkeeping that the mechanism itself abandoned, plus the fetch refs giti's own `status`
 * created. Subtrees leave nothing of their own — they are merges into the parent's history — so
 * for them only those fetch refs are collected.
 *
 * @param kind - Which mechanism's leftovers to collect
 * @param cwd - Any directory inside the repository
 * @param options - Whether to only report
 * @returns What went, and anything worth reporting about why nothing did
 */
const cleanVendored = async (
  kind: VendorKind,
  cwd: string,
  { dryRun = false, forward = [] }: CleanVendoredOptions = {},
): Promise<VendoredCleanReport> => {
  const rootResult = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (rootResult.exitCode !== 0) {
    return { kind, removed: [], notes: ['Not inside a git repository.'] };
  }
  const root = rootResult.stdout.trim();

  const own =
    kind === 'subrepo'
      ? await cleanSubrepo(root, cwd, dryRun, forward)
      : kind === 'submodule'
        ? await cleanSubmodule(root, cwd, dryRun)
        : { removed: [], notes: [] };

  const gitiRefs = await removeGitiRefs(kind, cwd, dryRun);

  return { kind, removed: [...own.removed, ...gitiRefs], notes: own.notes };
};

export default cleanVendored;

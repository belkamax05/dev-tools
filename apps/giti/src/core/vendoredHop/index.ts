import { existsSync } from 'node:fs';
import { join } from 'node:path';

import getSubmodules from '../../utils/getSubmodules';
import getSubrepos from '../../utils/getSubrepos';
import { removeSubrepoWorktree } from '../../utils/subrepoWorktree';
import git, { failure } from '../run';
import type { OperationResult } from '../status';

/**
 * What following the parent onto its new branch means for one vendored directory:
 *
 * - `switch` — a submodule that has the branch: `git switch` to it there.
 * - `create` — a submodule that does not: start the branch there, at what is checked out.
 * - `retarget` — a subrepo whose upstream has the branch: pull from it and record it in `.gitrepo`.
 * - `publish` — a subrepo whose upstream does not: push this copy as that branch and record it.
 * - `none` — nothing to do, or nothing that can be done; `note` says which.
 */
export type HopAction = 'switch' | 'create' | 'retarget' | 'publish' | 'none';

export interface VendoredHop {
  kind: 'submodule' | 'subrepo';
  /** Path relative to the parent's root. */
  dir: string;
  /** Absolute path. */
  path: string;
  /** The branch it is on now: a submodule's checkout ('' when detached), a subrepo's `.gitrepo`. */
  current: string;
  /** Where the target branch was found; `null` when upstream could not be asked. */
  found: 'local' | 'remote' | 'nowhere' | null;
  action: HopAction;
  /**
   * Picked from the start. Only a submodule switching to a branch it already has is: that is the
   * step that keeps parent and submodule on the same name. A subrepo is never — retargeting it
   * pulls or pushes upstream, which is the user's call every time.
   */
  recommended: boolean;
  /** Why the action is what it is, or what to look out for — one line. */
  note: string;
}

//? Upstream is asked by `ls-remote`, which can sit on a slow network or an SSH agent waiting for a
//? tap; past this the entry is shown as "could not check" rather than holding the whole step up
const LS_REMOTE_TIMEOUT_MS = 15_000;

/**
 * Whether `remote` has `branch`, without fetching anything.
 *
 * @returns true / false, or null when the remote could not be reached in time
 */
const remoteHasBranch = async (remote: string, branch: string, cwd: string) => {
  const asked = git(['ls-remote', '--exit-code', '--heads', remote, branch], cwd).then((result) =>
    //? --exit-code: 2 is "reached it, no such ref"; anything else non-zero is a failure to ask
    result.ok ? true : result.exitCode === 2 ? false : null,
  );
  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), LS_REMOTE_TIMEOUT_MS),
  );
  return Promise.race([asked, timeout]);
};

/** The remote a submodule's branches come from: `origin`, else its only one. */
const submoduleRemote = async (path: string) => {
  const remotes = (await git(['remote'], path)).stdout.split('\n').filter(Boolean);
  return remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined;
};

const planSubmodule = async (dir: string, path: string, branch: string): Promise<VendoredHop> => {
  const base = { kind: 'submodule' as const, dir, path };
  //? An uninitialised submodule is an empty folder inside the parent's work tree, and git run
  //? there would answer for the parent — so its own `.git` is checked for, not git's opinion
  if (!existsSync(join(path, '.git'))) {
    return {
      ...base,
      current: '',
      found: null,
      action: 'none',
      recommended: false,
      note: 'not checked out (git submodule update --init)',
    };
  }

  const head = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], path);
  const current = head.ok ? head.stdout.trim() : '';
  if (current === branch) {
    return {
      ...base,
      current,
      found: 'local',
      action: 'none',
      recommended: false,
      note: `already on ${branch}`,
    };
  }

  const dirty = (await git(['status', '--porcelain'], path)).stdout.split('\n').filter(Boolean);
  const dirtyNote = dirty.length
    ? `${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'} — they travel along, or stop the switch`
    : '';

  const local = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], path);
  const remote = local.ok ? undefined : await submoduleRemote(path);
  const found = local.ok
    ? 'local'
    : !remote
      ? 'nowhere'
      : await remoteHasBranch(remote, branch, path).then((has) =>
          has === null ? null : has ? 'remote' : 'nowhere',
        );

  if (found === null) {
    return {
      ...base,
      current,
      found,
      action: 'none',
      recommended: false,
      note: `could not reach ${remote} to look for ${branch}`,
    };
  }
  if (found === 'nowhere') {
    return {
      ...base,
      current,
      found,
      action: 'create',
      recommended: false,
      note: [
        `no ${branch} here or upstream — create it from ${current || 'the pinned commit'}`,
        dirtyNote,
      ]
        .filter(Boolean)
        .join('; '),
    };
  }
  return {
    ...base,
    current,
    found,
    action: 'switch',
    //? A dirty checkout is still offered, just not ticked: git may refuse, or carry the changes
    //? onto a branch they were not written for — either way the user should be looking
    recommended: dirty.length === 0,
    note:
      dirtyNote ||
      (found === 'local'
        ? `${branch} exists here`
        : `${branch} exists on ${remote} — a tracking branch is made`),
  };
};

const planSubrepo = async (
  root: string,
  dir: string,
  path: string,
  remote: string,
  current: string,
  branch: string,
): Promise<VendoredHop> => {
  const base = { kind: 'subrepo' as const, dir, path, current, recommended: false };
  if (current === branch) {
    return { ...base, found: 'remote', action: 'none', note: `already tracks ${branch}` };
  }
  if (!remote) {
    return { ...base, found: null, action: 'none', note: '.gitrepo names no remote' };
  }
  const has = await remoteHasBranch(remote, branch, root);
  if (has === null) {
    return { ...base, found: null, action: 'none', note: `could not reach ${remote}` };
  }
  return has
    ? {
        ...base,
        found: 'remote',
        action: 'retarget',
        note: `upstream has ${branch} — pull it in and track it (git subrepo pull -b ${branch} -u)`,
      }
    : {
        ...base,
        found: 'nowhere',
        action: 'publish',
        note: `no ${branch} upstream — push this copy as ${branch} and track it (git subrepo push -b ${branch} -u)`,
      };
};

/**
 * What each submodule and subrepo of `root` could do to follow the parent onto `branch`.
 *
 * Subtrees are left out: a subtree has no branch of its own to be on — which upstream branch it
 * pulls from is an argument to each pull, not a state to switch.
 *
 * ! Asks each upstream (`ls-remote`) that it has to: a subrepo has no local refs to look in, and
 * ! a submodule's remote branch may be newer than its last fetch. All entries are asked at once.
 */
export const planVendoredHop = async (
  root: string,
  branch: string,
  /** Told how many entries are about to be asked about — before any of the network waits. */
  onStart?: (count: number) => void,
): Promise<VendoredHop[]> => {
  const [submodules, subrepos] = await Promise.all([getSubmodules(root), getSubrepos(root)]);
  if (submodules.length + subrepos.length) onStart?.(submodules.length + subrepos.length);
  return Promise.all([
    ...submodules.map((entry) => planSubmodule(entry.dir, entry.path, branch)),
    ...subrepos.map((entry) =>
      planSubrepo(root, entry.dir, entry.path, entry.remote, entry.branch, branch),
    ),
  ]);
};

/**
 * `planVendoredHop` for the branch `root` has just switched to — the dashboard's Branches view,
 * which knows a switch went through but not which local name it landed on.
 *
 * @returns The branch and its plan, or null when HEAD is detached (no name to follow)
 */
export const planVendoredHopAtHead = async (
  root: string,
  onStart?: (branch: string, count: number) => void,
): Promise<{ branch: string; entries: VendoredHop[] } | null> => {
  const head = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root);
  if (!head.ok) return null;
  const branch = head.stdout.trim();
  const entries = await planVendoredHop(root, branch, (count) => onStart?.(branch, count));
  return { branch, entries };
};

/**
 * Hooks off for every git-subrepo run here, for the reason `pullVendored` gives: the host's
 * pre-commit would rewrite the commit git-subrepo makes of upstream's code.
 */
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];

/**
 * Carry out one entry's action.
 *
 * @param root - The parent repository's root; subrepo commands run there
 * @param entry - From `planVendoredHop`
 * @param branch - The branch the parent switched to
 */
export const applyVendoredHop = async (
  root: string,
  entry: VendoredHop,
  branch: string,
): Promise<OperationResult> => {
  const { path, dir, action } = entry;
  const done = (message: string): OperationResult => ({ ok: true, message: `${dir}: ${message}` });
  const failed = (result: Awaited<ReturnType<typeof git>>, fallback: string): OperationResult => ({
    ok: false,
    message: `${dir}: ${failure(result, fallback)}`,
  });

  switch (action) {
    case 'switch': {
      if (entry.found === 'remote') {
        //? Brings `<remote>/<branch>` in, so the plain `git switch` below finds exactly one remote
        //? branch of that name and makes the local one tracking it
        const remote = (await submoduleRemote(path)) ?? 'origin';
        const fetched = await git(['fetch', '--no-tags', remote, branch], path);
        if (!fetched.ok) return failed(fetched, 'fetch failed');
      }
      const switched = await git(['switch', branch], path);
      return switched.ok ? done(`switched to ${branch}`) : failed(switched, 'git switch failed');
    }
    case 'create': {
      const created = await git(['switch', '-c', branch], path);
      return created.ok
        ? done(`created ${branch}`)
        : failed(created, 'could not create the branch');
    }
    case 'retarget':
    case 'publish': {
      const verb = action === 'retarget' ? 'pull' : 'push';
      const ran = await git(
        [...NO_HOOKS, 'subrepo', verb, dir, `--branch=${branch}`, '--update'],
        root,
      );
      if (ran.ok) {
        return done(
          action === 'retarget'
            ? `now tracks ${branch} (pulled)`
            : `pushed as ${branch}, now tracks it`,
        );
      }
      //? A stopped git-subrepo run leaves its worktree registered, and every later pull of this
      //? subrepo trips over it — nothing in it is worth keeping
      await removeSubrepoWorktree(dir, root);
      await git([...NO_HOOKS, 'subrepo', 'clean', dir], root);
      return failed(ran, `git subrepo ${verb} failed`);
    }
    default:
      return done(entry.note);
  }
};

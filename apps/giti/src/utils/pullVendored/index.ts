import { join } from 'node:path';
import { log } from '@clack/prompts';
import formatColor from '@/dev-tools/utils/format/formatColor';
import describePull from '../describePull';
import getTrackedBranch from '../getTrackedBranch';
import getVendoredState from '../getVendoredState';
import gitExec from '../gitExec';
import resolveSubtreeUpstream from '../resolveSubtreeUpstream';
import type { GitStep } from '../runGitStep';
import runGitStep from '../runGitStep';
import type { Vendored, VendoredOutcome } from '../vendored';
import { plural } from '../vendored';
import type { FlagTarget, VendoredArgs } from '../vendoredArgs';
import vendoredLabel from '../vendoredLabel';
import {
  explainDroppedFlags,
  forwardVendoredFlags,
  hasOwn,
  setsIntegration,
  setsSubmoduleMode,
} from '../vendoredArgs';

/**
 * Every git this file runs against a vendored directory runs with the host's hooks off. A pull
 * commits upstream's code into the host, and a host pre-commit formatter (lint-staged) rewrote it
 * inside that commit — the copy drifted from upstream, and the next pull touching the same lines
 * conflicted with a change nobody made. Vendored code lands exactly as upstream wrote it.
 * `-c` reaches the commits git-subrepo makes too: git hands it to every git it runs, through
 * GIT_CONFIG_PARAMETERS.
 */
const NO_HOOKS = ['-c', 'core.hooksPath=/dev/null'];

/**
 * A pull aborted half-way leaves the worktree git-subrepo builds under `.git/tmp/subrepo/<dir>`
 * registered, and every later pull of that subrepo then fails with "There is already a worktree
 * with branch subrepo/<dir>". It is knowable up front.
 *
 * ! The worktree is the tell, not the `subrepo/<dir>` branch. git-subrepo keeps that branch after
 * ! every *successful* pull (it is what a later `git subrepo push` starts from), and a pull with
 * ! the branch present but no worktree on it works fine — checked against git-subrepo 0.4.9.
 * ! Testing for the branch refused to pull any subrepo that had ever been pulled before.
 */
const subrepoWorktree = async (dir: string, cwd: string) => {
  const worktrees = await gitExec(['worktree', 'list', '--porcelain'], cwd);
  if (worktrees.exitCode !== 0) return undefined;
  //? Porcelain output is blank-line separated records: `worktree <path>` first, then `branch`.
  for (const record of worktrees.stdout.split('\n\n')) {
    const lines = record.split('\n');
    if (lines.includes(`branch refs/heads/subrepo/${dir}`)) {
      return lines.find((line) => line.startsWith('worktree '))?.slice('worktree '.length);
    }
  }
  return undefined;
};

/**
 * Throw away a subrepo pull's half-done state — its worktree, then git-subrepo's branch and refs
 * — so the host is exactly where it was and the next pull starts clean. Nothing here touches the
 * host's working tree: a merge-method pull only changes the host once it has fully succeeded.
 */
const discardSubrepoAttempt = async (dir: string, cwd: string) => {
  const worktree = await subrepoWorktree(dir, cwd);
  if (worktree) await gitExec(['worktree', 'remove', '--force', worktree], cwd);
  await gitExec(['worktree', 'prune'], cwd);
  await gitExec([...NO_HOOKS, 'subrepo', 'clean', dir], cwd);
};

/** Files left conflicted in a failed subrepo pull's worktree. */
const conflictedFiles = async (worktree: string) =>
  (await gitExec(['diff', '--name-only', '--diff-filter=U'], worktree)).stdout
    .split('\n')
    .filter(Boolean);

/**
 * Finish a conflicted subrepo pull with upstream's side of every conflict — what `--theirs`
 * asks for, and nearly always right for vendored code, whose local edits belong upstream anyway.
 * A file upstream deleted is deleted. Then the merge is committed in the worktree and
 * `git subrepo commit` brings it into the host, the step `git subrepo pull` itself never reached.
 */
const settleWithTheirs = async (dir: string, worktree: string, conflicts: string[], cwd: string) => {
  for (const file of conflicts) {
    const taken = await gitExec(['checkout', '--theirs', '--', file], worktree);
    if (taken.exitCode !== 0) await gitExec(['rm', '-q', '--', file], worktree);
  }
  const staged = await gitExec(['add', '-A'], worktree);
  if (staged.exitCode !== 0) return false;
  const merged = await gitExec([...NO_HOOKS, 'commit', '--no-edit'], worktree);
  if (merged.exitCode !== 0) return false;
  const committed = await gitExec([...NO_HOOKS, 'subrepo', 'commit', dir], cwd);
  return committed.exitCode === 0;
};

const moved = (behind: number | null) => (behind === null ? '' : ` ${plural(behind, 'commit')}`);

/**
 * Where a vendored directory sits, as a commit: what each mechanism writes down about its copy.
 * Read before and after a pull, the two answer "what did that pull move" the same way for all
 * three — a subrepo's `.gitrepo`, a submodule's own HEAD, the parent's HEAD for a subtree (whose
 * pull is a commit in the parent).
 */
const positionOf = async ({ kind, path }: Vendored, cwd: string) => {
  const result =
    kind === 'subrepo'
      ? await gitExec(['config', '--file', join(path, '.gitrepo'), 'subrepo.commit'], cwd)
      : await gitExec(['rev-parse', 'HEAD'], kind === 'submodule' ? path : cwd);
  return result.exitCode === 0 ? result.stdout.trim() : '';
};

/**
 * Close a step that succeeded with what it actually moved. A pull can succeed having moved
 * nothing — the repository's own pull already brought the new commit in, or upstream went back —
 * and that is reported and counted as current, not as pulled.
 */
const finish = async (
  step: GitStep,
  vendored: Vendored,
  cwd: string,
  label: string,
  before: string,
): Promise<VendoredOutcome> => {
  const after = await positionOf(vendored, cwd);
  //? A subrepo's commits live in the parent, fetched there by `git subrepo pull`.
  const history = vendored.kind === 'submodule' ? vendored.path : cwd;
  step.succeed(`${label}  ${(await describePull(before, after, history)).join('\n')}`);
  return before && before === after ? 'current' : 'done';
};

/**
 * Bring one vendored directory up to its upstream, whichever mechanism vendored it.
 *
 * Each mechanism pulls with a different git command, but all three want the same two questions
 * answered first — has upstream actually moved, and is there uncommitted work in the way — and all
 * three report the failure late and messily if nobody asks. Each entry prints as clack lines —
 * its kind and path, then what happened — with the git command's own output live only while it
 * runs, so a run over a whole repository reads as one list, the way `mr update` does.
 *
 * @param vendored - Entry from `getSubrepos`, `getSubmodules` or `getSubtrees`
 * @param cwd - Any directory inside the parent repository
 * @param args - Split arguments; giti's own half targets the subtree, the rest reaches git
 * @returns What happened, for the caller's tally
 */
const pullVendored = async (
  vendored: Vendored,
  cwd: string,
  args: VendoredArgs = { dirs: [], own: [], passthrough: [] },
): Promise<VendoredOutcome> => {
  const { kind, dir } = vendored;
  const label = vendoredLabel(kind, dir);

  //? `git subtree` records no upstream at all, so for that one the target has to be recovered
  //? from the flags or a same-named remote before anything can be compared, let alone merged.
  const upstream = kind === 'subtree' ? await resolveSubtreeUpstream(vendored, args, cwd) : null;
  if (kind === 'subtree' && !upstream) {
    log.warn(
      `${label}  ${formatColor('skipped', 'warning')} · git subtree records no remote, and none ` +
        'was given. Pass --remote=<name-or-url> (and --branch= if it is not the default).',
    );
    return 'skipped';
  }

  //? A worktree left by a pull that crashed or was killed would make this one fail — and it
  //? holds nothing worth keeping, since a pull only changes the host once it succeeds. Cleared
  //? up front, so a past failure never blocks a later run.
  if (kind === 'subrepo' && (await subrepoWorktree(dir, cwd))) {
    await discardSubrepoAttempt(dir, cwd);
    log.info(`${label}  cleared what an earlier, unfinished pull left behind`);
  }

  //? No passthrough on this one: it is giti's own look at the upstream, not the pull the user
  //? asked for, and `git fetch` rejects the flags a pull takes.
  const { behind, dirty, localChanges } = await getVendoredState({ ...vendored, ...upstream }, cwd);

  if (behind === 0) {
    log.success(`${label}  ${formatColor('up to date', 'success')}`);
    return 'current';
  }

  //? A subrepo pull rebuilds the directory, a submodule pull merges upstream into the checkout and
  //? a subtree pull merges into the parent's own tree: in all three, uncommitted work is in the
  //? way, and in all three git says so only once the operation is already half-done.
  if (kind !== 'subrepo' && dirty.length > 0) {
    const where = kind === 'submodule' ? 'inside the submodule' : 'under the prefix';
    log.warn(
      `${label}  ${formatColor('skipped', 'warning')} · ` +
        `${plural(dirty.length, 'uncommitted file')} ${where} — commit or stash them before ` +
        'merging upstream in.',
    );
    return 'skipped';
  }

  const before = await positionOf(vendored, cwd);

  //? A submodule someone switched onto a branch is pulled like any checkout on a branch: from that
  //? branch's own upstream. `git submodule update --remote --merge` would instead merge
  //? `.gitmodules`' branch — or, with none declared, the remote's default branch — into it, which
  //? is how `main` lands in a release branch. Same --ff-only rule as the repository's own pull.
  const tracked = kind === 'submodule' ? await getTrackedBranch(vendored.path) : null;
  if (tracked) {
    const { flags } = forwardVendoredFlags(args.passthrough, 'git');
    const own = setsIntegration(flags) ? [] : ['--ff-only'];
    const step = await runGitStep(
      `${label}  pulling${moved(behind)} from ${tracked.label}`,
      [...NO_HOOKS, 'pull', ...own, ...flags],
      vendored.path,
    );
    if (step.exitCode !== 0) {
      step.fail(
        own.length > 0
          ? `${label}  ${formatColor('pull failed', 'error')} · ${tracked.label} cannot ` +
              'fast-forward, so resolve it by hand.'
          : `${label}  ${formatColor('pull failed', 'error')}`,
      );
      return 'failed';
    }
    return finish(step, vendored, cwd, label, before);
  }

  //? Whatever the user typed goes to the command that actually runs, so a flag means the same
  //? thing here as it does when the mechanism is driven by hand.
  const forwardTo: FlagTarget =
    kind === 'subrepo' ? 'subrepo' : kind === 'submodule' ? 'submodule-update' : 'subtree';
  const { flags, config, dropped } = forwardVendoredFlags(args.passthrough, forwardTo);
  if (dropped.length > 0) log.warn(`${label}  ${explainDroppedFlags(dropped, forwardTo)}`);

  const command =
    kind === 'subrepo'
      ? ['subrepo', 'pull', dir, ...flags]
      : kind === 'submodule'
        ? [
            'submodule',
            'update',
            '--remote',
            //? --merge is giti's default, not the user's: naming a mode themselves replaces it,
            //? because `git submodule update` refuses two of them at once.
            ...(setsSubmoduleMode(flags) ? [] : ['--merge']),
            ...flags,
            dir,
          ]
        : [
            'subtree',
            'pull',
            '--prefix',
            dir,
            ...flags,
            upstream?.remote ?? '',
            upstream?.branch ?? '',
          ];

  const target = kind === 'subtree' ? ` from ${upstream?.remote} ${upstream?.branch}` : '';
  const step = await runGitStep(
    `${label}  ${kind === 'subrepo' ? 'pulling' : 'merging'}${moved(behind)}${target}`,
    [...NO_HOOKS, ...config, ...command],
    cwd,
  );
  if (step.exitCode === 0) return finish(step, vendored, cwd, label, before);
  if (kind !== 'subrepo') {
    step.fail(`${label}  ${formatColor('pull failed', 'error')}`);
    return 'failed';
  }

  //? A subrepo pull that stops never leaves its half-done merge behind: either `--theirs`
  //? finishes it, or it is thrown away and the host is exactly as it was before the pull.
  const worktree = await subrepoWorktree(dir, cwd);
  const conflicts = worktree ? await conflictedFiles(worktree) : [];
  if (worktree && conflicts.length > 0 && hasOwn(args, '--theirs')) {
    if (await settleWithTheirs(dir, worktree, conflicts, cwd)) {
      await discardSubrepoAttempt(dir, cwd);
      return finish(step, vendored, cwd, label, before);
    }
  }
  await discardSubrepoAttempt(dir, cwd);

  if (conflicts.length === 0) {
    step.fail(`${label}  ${formatColor('pull failed', 'error')} · nothing was changed`);
    return 'failed';
  }
  //? Conflicts here mean this copy differs from upstream in lines upstream also changed — say
  //? which of them this repository changed, since that is what has to go (or go upstream).
  const drifted = new Set(localChanges ?? []);
  const local = conflicts.filter((file) => drifted.has(file));
  step.fail(
    [
      `${label}  ${formatColor('conflicts', 'error')} · the pull was undone, nothing was changed.`,
      `  Upstream changed lines this copy also changed: ${conflicts.join(', ')}`,
      ...(local.length > 0
        ? [`  This repository's copy differs from upstream in: ${local.join(', ')}`]
        : []),
      "  To take upstream's version of those files: giti mega pull --theirs",
    ].join('\n'),
    //? git-subrepo's own advice ("finish the pull by hand in .git/tmp/subrepo/...") describes a
    //? worktree that no longer exists — it was just thrown away
    { quiet: true },
  );
  return 'failed';
};

export default pullVendored;

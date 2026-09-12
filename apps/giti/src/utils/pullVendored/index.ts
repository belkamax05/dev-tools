import getVendoredState from '../getVendoredState';
import gitExec from '../gitExec';
import resolveSubtreeUpstream from '../resolveSubtreeUpstream';
import type { Vendored, VendoredOutcome } from '../vendored';
import { plural } from '../vendored';
import type { FlagTarget, VendoredArgs } from '../vendoredArgs';
import { explainDroppedFlags, forwardVendoredFlags, setsSubmoduleMode } from '../vendoredArgs';

/**
 * A pull aborted half-way leaves the working branch and worktree git-subrepo builds under
 * `.git/tmp/subrepo/<dir>` in place, and every later pull of that subrepo then fails with
 * "There is already a worktree with branch subrepo/<dir>". It is knowable up front.
 */
const hasLeftoverWorktree = async (dir: string, cwd: string) => {
  const branches = await gitExec(['branch', '--list', `subrepo/${dir}`], cwd);
  return branches.exitCode === 0 && branches.stdout.trim().length > 0;
};

const moved = (behind: number | null) => (behind === null ? '' : ` ${plural(behind, 'commit')}`);

/**
 * Bring one vendored directory up to its upstream, whichever mechanism vendored it.
 *
 * Each mechanism pulls with a different git command, but all three want the same two questions
 * answered first — has upstream actually moved, and is there uncommitted work in the way — and all
 * three report the failure late and messily if nobody asks. Progress is printed per entry so a run
 * over a whole repository reads as one list.
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

  //? `git subtree` records no upstream at all, so for that one the target has to be recovered
  //? from the flags or a same-named remote before anything can be compared, let alone merged.
  const upstream = kind === 'subtree' ? await resolveSubtreeUpstream(vendored, args, cwd) : null;
  if (kind === 'subtree' && !upstream) {
    console.error(
      `❌ ${dir}: git subtree records no remote, and none was given. ` +
        'Pass --remote=<name-or-url> (and --branch= if it is not the default).',
    );
    return 'skipped';
  }

  //? No passthrough on this one: it is giti's own look at the upstream, not the pull the user
  //? asked for, and `git fetch` rejects the flags a pull takes.
  const { behind, dirty } = await getVendoredState({ ...vendored, ...upstream }, cwd);

  if (behind === 0) {
    console.log(`   ${dir}: already up to date`);
    return 'current';
  }

  //? A subrepo pull rebuilds the directory, a submodule pull merges upstream into the checkout and
  //? a subtree pull merges into the parent's own tree: in all three, uncommitted work is in the
  //? way, and in all three git says so only once the operation is already half-done.
  if (kind !== 'subrepo' && dirty.length > 0) {
    const where = kind === 'submodule' ? 'inside the submodule' : 'under the prefix';
    console.error(
      `❌ ${dir}: ${plural(dirty.length, 'uncommitted file')} ${where}. Commit or stash them ` +
        'before merging upstream in.',
    );
    return 'skipped';
  }

  if (kind === 'subrepo' && (await hasLeftoverWorktree(dir, cwd))) {
    console.error(
      `❌ ${dir}: a leftover 'subrepo/${dir}' branch from an interrupted run would make this ` +
        `fail. Run \`giti subrepo/clean ${dir}\` first.`,
    );
    return 'skipped';
  }

  //? Whatever the user typed goes to the command that actually runs, so a flag means the same
  //? thing here as it does when the mechanism is driven by hand.
  const forwardTo: FlagTarget =
    kind === 'subrepo' ? 'subrepo' : kind === 'submodule' ? 'submodule-update' : 'subtree';
  const { flags, config, dropped } = forwardVendoredFlags(args.passthrough, forwardTo);
  if (dropped.length > 0) console.warn(`   ${dir}: ${explainDroppedFlags(dropped, forwardTo)}`);

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
  console.log(
    `⬇️  ${dir}: ${kind === 'subrepo' ? 'pulling' : 'merging'}${moved(behind)}${target}...`,
  );

  const result = await gitExec([...config, ...command], cwd, { stream: true });
  if (result.exitCode === 0) return 'done';

  console.error(`❌ ${dir}: pull failed.`);
  return 'failed';
};

export default pullVendored;

import stepProgress from '../stepProgress';
import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import describePush from '../describePush';
import getVendoredState from '../getVendoredState';
import resolveSubtreeUpstream from '../resolveSubtreeUpstream';
import runGitStep from '../runGitStep';
import type { Vendored, VendoredOutcome } from '../vendored';
import { plural } from '../vendored';
import type { FlagTarget, VendoredArgs } from '../vendoredArgs';
import { explainDroppedFlags, forwardVendoredFlags } from '../vendoredArgs';
import vendoredLabel from '../vendoredLabel';

/** `git push` flags that are about the repository's own branch, not a vendored copy's. */
const SELF_ONLY = new Set(['-u', '--set-upstream']);

/**
 * Send one vendored directory's local work back upstream, whichever mechanism vendored it.
 *
 * All three push commands fail on the same three conditions — uncommitted work, nothing to send,
 * upstream having moved — and all three fail *late*, after building a working branch and worktree
 * that then have to be cleaned up by hand. Every one of them is answerable before any of that
 * work starts, so this refuses up front instead.
 *
 * Each entry prints as clack lines, the way `pullVendored` does — its kind and path, then what
 * happened — with the push command's own output live only while it runs, so `send` reads as one
 * list just as `receive` does.
 *
 * @param vendored - Entry from `getSubrepos`, `getSubmodules` or `getSubtrees`
 * @param cwd - Any directory inside the parent repository
 * @param args - Split arguments; giti's own half targets the subtree, the rest reaches git
 * @returns What happened, for the caller's tally
 */
const pushVendored = async (
  vendored: Vendored,
  cwd: string,
  args: VendoredArgs = { dirs: [], own: [], passthrough: [] },
): Promise<VendoredOutcome> => {
  const { kind, dir, path } = vendored;
  const label = vendoredLabel(kind, dir);
  const skipped = (why: string) => {
    stepProgress.log.warn(`${label}  ${formatColor('skipped', 'warning')} · ${why}`);
    return 'skipped' as const;
  };
  const current = (why: string) => {
    stepProgress.log.success(`${label}  ${formatColor('nothing to push', 'success')} · ${why}`);
    return 'current' as const;
  };

  const upstream = kind === 'subtree' ? await resolveSubtreeUpstream(vendored, args, cwd) : null;
  if (kind === 'subtree' && !upstream) {
    return skipped(
      'git subtree records no remote, and none was given. ' +
        'Pass --remote=<name-or-url> (and --branch= if it is not the default).',
    );
  }

  const { behind, localChanges, ahead, gitlinkBehind, dirty } = await getVendoredState(
    { ...vendored, ...upstream },
    cwd,
  );

  if (dirty.length > 0) {
    const where =
      kind === 'submodule'
        ? 'in the submodule'
        : kind === 'subtree'
          ? 'under the prefix'
          : 'in the subrepo';
    return skipped(
      `${plural(dirty.length, 'uncommitted file')} ${where} — commit or stash them: ` +
        'a push only sends committed history.',
    );
  }

  //? A submodule sends its own commits, so whether there is anything to send is a question about
  //? its history against upstream. The parent's pinned commit answers a different question and
  //? gets both cases wrong: a moved-and-pushed checkout looks like work, and unpushed commits
  //? under an already-recorded pointer look like none.
  if (kind === 'submodule' && ahead === 0) {
    const stale = gitlinkBehind !== null && gitlinkBehind > 0;
    const tail = stale ? ' — commit the moved gitlink in the parent to record it' : '';
    return current(`every commit is already upstream${tail}`);
  }

  if (kind !== 'submodule' && localChanges !== null && localChanges.length === 0) {
    const pinned = vendored.commit ? formatArg(vendored.commit.slice(0, 7)) : 'upstream';
    const same =
      kind === 'subtree' ? 'the prefix matches upstream' : `identical to ${pinned} upstream`;
    return current(same);
  }

  if (behind !== null && behind > 0) {
    const rejected = kind === 'subrepo' ? 'unmerged' : 'non-fast-forward';
    return skipped(
      `upstream moved ${plural(behind, 'commit')} since the last pull, so the push would be ` +
        `rejected as ${rejected}. Run \`giti receive ${dir}\` first.`,
    );
  }

  //? `git subrepo push` and `git subtree push` have no dry run — forwarded, the flag would be
  //? dropped and the push would really happen. So a dry run stops here and says what it would do;
  //? a submodule is a plain `git push`, which takes --dry-run itself.
  const dryRun = args.passthrough.some((flag) => flag === '--dry-run' || flag === '-n');
  if (dryRun && kind !== 'submodule') {
    const what =
      localChanges && localChanges.length > 0 ? plural(localChanges.length, 'changed file') : 'its changes';
    const to = kind === 'subtree' ? ` to ${upstream?.remote} ${upstream?.branch}` : '';
    stepProgress.log.info(`${label}  ${formatColor('dry run', 'info')} · would push ${what}${to}`);
    return 'done';
  }

  //? Whatever the user typed goes to the command that actually runs, so `--no-verify` on a mega
  //? push skips the hooks of every push it makes, not only the ones giti builds itself.
  const forwardTo: FlagTarget =
    kind === 'subrepo' ? 'subrepo' : kind === 'submodule' ? 'git' : 'subtree';
  //? Setting the upstream is about the repository's own branch, never a vendored push — and to
  //? `git subrepo` `-u` is --update, which would rewrite the entry's .gitrepo remote
  const forwardable = args.passthrough.filter((flag) => !SELF_ONLY.has(flag));
  const { flags, config, dropped } = forwardVendoredFlags(forwardable, forwardTo);
  if (dropped.length > 0) stepProgress.log.warn(`${label}  ${explainDroppedFlags(dropped, forwardTo)}`);

  //? A submodule's copy is a repository of its own and its own commits are what travel, so its
  //? push runs inside it. The other two are trees in the parent, pushed by the parent.
  const [command, runIn]: [string[], string] =
    kind === 'subrepo'
      ? [['subrepo', 'push', dir, ...flags], cwd]
      : kind === 'submodule'
        ? [['push', ...flags], path]
        : [
            [
              'subtree',
              'push',
              '--prefix',
              dir,
              ...flags,
              upstream?.remote ?? '',
              upstream?.branch ?? '',
            ],
            cwd,
          ];

  const what =
    kind === 'subtree'
      ? ` to ${upstream?.remote} ${upstream?.branch}`
      : kind === 'submodule'
        ? ahead === null
          ? ''
          : ` ${plural(ahead, 'commit')}`
        : localChanges
          ? ` ${plural(localChanges.length, 'changed file')}`
          : '';

  //? A subrepo or subtree push runs in the host, and the host's hooks have no business there:
  //? its pre-commit would rewrite the `.gitrepo` commit git-subrepo makes, its pre-push would
  //? judge a push to another project's remote. A submodule push runs its own repository's hooks.
  const noHooks = kind === 'submodule' ? [] : ['-c', 'core.hooksPath=/dev/null'];
  const step = await runGitStep(`${label}  pushing${what}`, [...noHooks, ...config, ...command], runIn);
  if (step.exitCode !== 0) {
    step.fail(`${label}  ${formatColor('push failed', 'error')}`);
    return 'failed';
  }
  //? A submodule push of a dry run moves nothing; git still lists the refs it would update
  const verb = dryRun ? 'would push' : 'pushed';
  step.succeed([`${label}  ${formatColor(`${verb}${what}`, 'success')}`, ...describePush(step.output)].join('\n'));
  return 'done';
};

export default pushVendored;

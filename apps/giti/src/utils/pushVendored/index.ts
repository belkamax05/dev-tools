import formatArg from '@/dev-tools/utils/format/formatArg';
import getVendoredState from '../getVendoredState';
import gitExec from '../gitExec';
import resolveSubtreeUpstream from '../resolveSubtreeUpstream';
import type { Vendored, VendoredOutcome } from '../vendored';
import { plural } from '../vendored';
import type { FlagTarget, VendoredArgs } from '../vendoredArgs';
import { explainDroppedFlags, forwardVendoredFlags } from '../vendoredArgs';

/**
 * Send one vendored directory's local work back upstream, whichever mechanism vendored it.
 *
 * All three push commands fail on the same three conditions — uncommitted work, nothing to send,
 * upstream having moved — and all three fail *late*, after building a working branch and worktree
 * that then have to be cleaned up by hand. Every one of them is answerable before any of that
 * work starts, so this refuses up front instead.
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

  const upstream = kind === 'subtree' ? await resolveSubtreeUpstream(vendored, args, cwd) : null;
  if (kind === 'subtree' && !upstream) {
    console.error(
      `❌ ${dir}: git subtree records no remote, and none was given. ` +
        'Pass --remote=<name-or-url> (and --branch= if it is not the default).',
    );
    return 'skipped';
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
    console.error(
      `❌ ${dir}: ${plural(dirty.length, 'uncommitted file')} ${where}. Commit or stash them — ` +
        'push only sends committed history.',
    );
    return 'skipped';
  }

  //? A submodule sends its own commits, so whether there is anything to send is a question about
  //? its history against upstream. The parent's pinned commit answers a different question and
  //? gets both cases wrong: a moved-and-pushed checkout looks like work, and unpushed commits
  //? under an already-recorded pointer look like none.
  if (kind === 'submodule' && ahead === 0) {
    const stale = gitlinkBehind !== null && gitlinkBehind > 0;
    const tail = stale ? ' — commit the moved gitlink in the parent to record it' : '';
    console.log(`ℹ️  ${dir}: nothing to push — every commit is already upstream${tail}.`);
    return 'current';
  }

  if (kind !== 'submodule' && localChanges !== null && localChanges.length === 0) {
    const pinned = vendored.commit ? formatArg(vendored.commit.slice(0, 7)) : 'upstream';
    const same =
      kind === 'subtree' ? 'the prefix matches upstream' : `identical to ${pinned} upstream`;
    console.log(`ℹ️  ${dir}: nothing to push — ${same}.`);
    return 'current';
  }

  if (behind !== null && behind > 0) {
    const rejected = kind === 'subrepo' ? 'unmerged' : 'non-fast-forward';
    console.error(
      `❌ ${dir}: upstream moved ${plural(behind, 'commit')} since the last pull, so the push ` +
        `would be rejected as ${rejected}. Run \`giti ${kind}/pull ${dir}\` first.`,
    );
    return 'skipped';
  }

  //? Whatever the user typed goes to the command that actually runs, so `--no-verify` on a mega
  //? push skips the hooks of every push it makes, not only the ones giti builds itself.
  const forwardTo: FlagTarget =
    kind === 'subrepo' ? 'subrepo' : kind === 'submodule' ? 'git' : 'subtree';
  const { flags, config, dropped } = forwardVendoredFlags(args.passthrough, forwardTo);
  if (dropped.length > 0) console.warn(`   ${dir}: ${explainDroppedFlags(dropped, forwardTo)}`);

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
  console.log(`⬆️  ${dir}: pushing${what}...`);

  const result = await gitExec([...config, ...command], runIn, { stream: true });
  if (result.exitCode === 0) return 'done';

  console.error(`❌ ${dir}: push failed.`);
  return 'failed';
};

export default pushVendored;

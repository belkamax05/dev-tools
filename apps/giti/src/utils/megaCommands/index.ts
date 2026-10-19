import { intro, isCancel, text } from '@clack/prompts';
import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import cleanVendored from '../cleanVendored';
import describePull from '../describePull';
import describePush from '../describePush';
import getMegaSelfState from '../getMegaSelfState';
import getMegaTree from '../getMegaTree';
import type { MegaGroup, MegaRepo, MegaTree } from '../getMegaTree';
import gitExec from '../gitExec';
import pullVendored from '../pullVendored';
import pushVendored from '../pushVendored';
import runGitStep from '../runGitStep';
import stepProgress from '../stepProgress';
import type { Vendored, VendoredOutcome } from '../vendored';
import { getDirtyPaths, plural, selectVendored } from '../vendored';
import type { VendoredArgs } from '../vendoredArgs';
import splitVendoredArgs, {
  explainDroppedFlags,
  forwardVendoredFlags,
  hasOwn,
  setsIntegration,
} from '../vendoredArgs';
import {
  OWN_FLAGS,
  formatVendoredLine,
  hasVendorTooling,
  printVendoredClean,
  printVendoredDiff,
  printVendoredStatus,
  withSubtreeUpstream,
} from '../vendoredCommands';
import vendoredLabel from '../vendoredLabel';

/**
 * Bodies shared by the `mega` command family.
 *
 * "mega" is every context at once: each subrepo, submodule and subtree, plus — where the operation
 * means anything for it — the repository they are all vendored into. The per-mechanism families
 * already share one implementation of each operation; these run that same implementation across
 * all three and label which group each answer came from, so the tree is one report instead of
 * three or four runs whose output has to be lined up by hand.
 */

/** How far vendored rows are indented under their group heading. */
const INDENT = '  ';

/** Which repo, where it is, and whether it is clean — then its origin — as two lines. */
const formatMegaHeaderLines = ({ name, branch, commit, remote, dirty }: MegaRepo) => {
  const at = commit ? formatArg(commit) : formatColor('no commits yet', 'warning');
  const on = branch && branch !== 'HEAD' ? branch : formatColor('detached HEAD', 'warning');
  const state =
    dirty.length > 0
      ? formatColor(plural(dirty.length, 'uncommitted file'), 'warning')
      : formatColor('clean', 'success');

  return [
    `${formatColor(name, 'command')}  ${on}  ${at}  ${state}`,
    remote || formatColor('no origin remote', 'warning'),
  ];
};

/** The banner every `mega` command opens with: which repo the rest of the output is about. */
export const formatMegaHeader = (repo: MegaRepo) => {
  const [what = '', origin = ''] = formatMegaHeaderLines(repo);
  return `📦 ${what}\n   ${origin}`;
};

/** Heading a group's rows sit under, so every answer says which mechanism it came from. */
const heading = ({ kind, entries }: MegaGroup) =>
  `\n${formatColor(`${kind}s`, 'catalog')}  ${entries.length}`;

/** Narrow every group at once, so a named directory can be looked for in all three. */
const select = (tree: MegaTree, dirs: string[]): MegaGroup[] =>
  tree.groups.map(({ kind, entries }) => ({ kind, entries: selectVendored(entries, dirs) }));

const countEntries = (groups: MegaGroup[]) =>
  groups.reduce((sum, group) => sum + group.entries.length, 0);

const columnWidth = (groups: MegaGroup[]) =>
  Math.max(0, ...groups.flatMap((group) => group.entries.map((entry) => entry.dir.length)));

/**
 * Why a selection came back empty, told apart the same way the per-mechanism families tell it
 * apart — nothing vendored at all, versus nothing matching what was named.
 */
const explainEmptyTree = (tree: MegaTree, dirs: string[]) => {
  if (tree.total === 0) return 'ℹ️  Nothing vendored here — no subrepos, submodules or subtrees.';

  const known = tree.groups.flatMap((group) => group.entries.map((entry) => entry.dir));
  return `ℹ️  Nothing matches ${dirs.join(', ')}. Known: ${known.join(', ')}`;
};

/** `mega/list`: the whole tree in one pass, grouped by the mechanism that vendored each entry. */
export const runMegaList = (tree: MegaTree) => {
  console.log(formatMegaHeader(tree.repo));

  if (tree.total === 0) {
    console.log(`\n${explainEmptyTree(tree, [])}`);
    return;
  }

  //? One width across every group rather than per group: the columns are the same columns, and
  //? re-measuring them per mechanism would stagger the listing for no reason.
  const width = columnWidth(tree.groups);

  for (const group of tree.groups) {
    if (group.entries.length === 0) {
      console.log(`\n${formatColor(`${group.kind}s`, 'catalog')}  ${formatColor('none', 'info')}`);
      continue;
    }

    console.log(heading(group));
    for (const entry of group.entries) {
      console.log(`${INDENT}${formatVendoredLine(entry, width)}`);
    }
  }

  const noun = tree.total === 1 ? 'directory' : 'directories';
  console.log(`\n${formatColor(`${tree.total} vendored ${noun}`, 'info')}`);
};

/** The repository's own line in `mega/status`, in the shape the vendored rows use. */
const printSelfStatus = async (
  repo: MegaRepo,
  width: number,
  fetch: boolean,
  forward: string[],
) => {
  const { upstream, behind, ahead } = await getMegaSelfState(repo.path, { fetch, forward });
  const notes: string[] = [];

  if (!upstream) notes.push('tracks no upstream branch');
  else {
    if (fetch && behind) notes.push(`${plural(behind, 'commit')} behind`);
    if (ahead) notes.push(`${plural(ahead, 'commit')} ahead`);
  }
  if (repo.dirty.length > 0) notes.push(plural(repo.dirty.length, 'uncommitted file'));

  const hint = behind ? 'giti receive' : ahead ? 'giti send' : '';
  const label =
    notes.length === 0
      ? formatColor(fetch ? 'up to date' : 'nothing to send', 'success')
      : formatColor(notes.join(', '), upstream ? 'warning' : 'info');

  console.log(`${INDENT}${'(this repo)'.padEnd(width)}  ${label}${hint ? `  → ${hint}` : ''}`);
};

/** `mega/status [<dir>...] [--no-fetch] [--no-self]`: where every context stands, in one report. */
export const runMegaStatus = async (tree: MegaTree, cwd: string, rawArgs: string[]) => {
  console.log(formatMegaHeader(tree.repo));

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.status);
  const groups = select(tree, args.dirs);
  const selected = countEntries(groups);
  const withSelf = !hasOwn(args, '--no-self');
  const fetch = !hasOwn(args, '--no-fetch');

  if (selected === 0 && !withSelf) {
    console.log(`\n${explainEmptyTree(tree, args.dirs)}`);
    return;
  }

  if (fetch) console.log(`\n🔄 Fetching ${plural(selected + (withSelf ? 1 : 0), 'upstream')}...`);

  const width = Math.max(columnWidth(groups), '(this repo)'.length);

  //? Every git this command runs is a fetch, so that is where the user's own flags belong — on
  //? the repository's own fetch as much as on the vendored ones, or `--prune` would mean two
  //? different things inside one report.
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');

  if (withSelf) {
    console.log(`\n${formatColor('this repository', 'catalog')}`);
    await printSelfStatus(tree.repo, width, fetch, flags);
  }

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    console.log(heading(group));
    const entries = await withSubtreeUpstream(group.entries, group.kind, cwd, args);
    await printVendoredStatus(entries, group.kind, cwd, {
      fetch,
      forward: flags,
      width,
      indent: INDENT,
    });
  }

  if (selected === 0) console.log(`\n${explainEmptyTree(tree, args.dirs)}`);
  if (!fetch) console.log(formatColor('\n--no-fetch: upstream was not checked.', 'info'));
};

/**
 * Where the repository's own push or pull goes when the user named it — `giti send origin main`,
 * the same two positionals `git push` / `git pull` take. Unset: its tracking branch.
 */
export interface TransferTarget {
  remote?: string;
  branch?: string;
}

/** The remote and branch as git's own positionals, for a target the user named. */
const targetArgs = ({ remote, branch }: TransferTarget) =>
  remote ? [remote, ...(branch ? [branch] : [])] : branch ? ['origin', branch] : [];

const isForce = (flag: string) =>
  flag === '--force' || flag === '-f' || flag.startsWith('--force-with-lease');

/** A push that only shows what it would do — `git push --dry-run` / `-n`. */
export const isDryRun = (flags: string[]) => flags.includes('--dry-run') || flags.includes('-n');

/**
 * Split the remote and branch `git push`/`git pull` take off the front of the positionals, so
 * `giti send origin main` means what `git push origin main` does. A positional is a remote only
 * when the repository has a remote of that name — vendored directories are the other positionals,
 * and a name can only be one of the two — and the one right after it is the branch.
 */
export const splitTransferTarget = (args: string[], remotes: string[]) => {
  const rest: string[] = [];
  const target: TransferTarget = {};
  let verbatim = false;
  for (const arg of args) {
    if (verbatim || arg.startsWith('-')) {
      if (arg === '--') verbatim = true;
      rest.push(arg);
      continue;
    }
    if (!target.remote && remotes.includes(arg)) {
      target.remote = arg;
      continue;
    }
    if (target.remote && !target.branch && rest.every((one) => one.startsWith('-'))) {
      target.branch = arg;
      continue;
    }
    rest.push(arg);
  }
  return { target, rest };
};

/** The repository's own pull: a fast-forward, refused rather than forced when it cannot be one. */
const pullSelf = async (
  repo: MegaRepo,
  args: VendoredArgs,
  target: TransferTarget = {},
): Promise<VendoredOutcome> => {
  const label = vendoredLabel('self');
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');
  const where = targetArgs(target);

  //? A remote and branch the user named are pulled as named: the tracking branch is no measure
  //? of them, so the "already up to date" shortcut does not apply and git says so itself
  if (where.length > 0) return pullFromTarget(repo, flags, where, label);

  //? No passthrough on this one: it is giti's own look at the upstream, not the pull the user
  //? asked for, and `git fetch` rejects the flags a pull takes.
  const { upstream, behind } = await getMegaSelfState(repo.path);

  if (!upstream) {
    stepProgress.log.success(`${label}  ${formatColor('tracks no upstream branch — nothing to pull', 'info')}`);
    return 'current';
  }

  if (behind === 0) {
    stepProgress.log.success(`${label}  ${formatColor('up to date', 'success')}`);
    return 'current';
  }

  //? A pull into a dirty tree either refuses half-way through or merges over work in progress,
  //? and which of the two it does depends on which files happen to overlap — unless the user
  //? asked for --autostash, which is git's own answer to exactly that
  if (repo.dirty.length > 0 && !flags.includes('--autostash')) {
    stepProgress.log.warn(
      `${label}  ${formatColor('skipped', 'warning')} · ` +
        `${plural(repo.dirty.length, 'uncommitted file')} in the way — commit or stash them ` +
        'before merging upstream in.',
    );
    return 'skipped';
  }

  //? --ff-only because the alternative is creating a merge commit in a command whose whole job is
  //? to bring copies up to date; anything that cannot fast-forward wants a person looking at it.
  //? It is giti's default rather than the user's, though: `--rebase`/`--no-ff` and the rest say
  //? how this pull should integrate, and git refuses two answers to that at once.
  const own = setsIntegration(flags) ? [] : ['--ff-only'];
  const before = (await gitExec(['rev-parse', 'HEAD'], repo.path)).stdout.trim();
  const step = await runGitStep(
    `${label}  pulling ${plural(behind ?? 0, 'commit')} from ${upstream}`,
    ['pull', ...own, ...flags],
    repo.path,
  );

  if (step.exitCode !== 0) {
    step.fail(
      own.length > 0
        ? `${label}  ${formatColor('pull failed', 'error')} · it cannot fast-forward, so resolve it by hand.`
        : `${label}  ${formatColor('pull failed', 'error')}`,
    );
    return 'failed';
  }

  const after = (await gitExec(['rev-parse', 'HEAD'], repo.path)).stdout.trim();
  step.succeed(`${label}  ${(await describePull(before, after, repo.path)).join('\n')}`);
  return 'done';
};

/** `git pull <remote> [<branch>]` for a target the user named — giti's checks do not apply. */
const pullFromTarget = async (
  repo: MegaRepo,
  flags: string[],
  where: string[],
  label: string,
): Promise<VendoredOutcome> => {
  if (repo.dirty.length > 0 && !flags.includes('--autostash')) {
    stepProgress.log.warn(
      `${label}  ${formatColor('skipped', 'warning')} · ` +
        `${plural(repo.dirty.length, 'uncommitted file')} in the way — commit or stash them, ` +
        'or pass --autostash.',
    );
    return 'skipped';
  }
  const own = setsIntegration(flags) ? [] : ['--ff-only'];
  const before = (await gitExec(['rev-parse', 'HEAD'], repo.path)).stdout.trim();
  const step = await runGitStep(
    `${label}  pulling from ${where.join(' ')}`,
    ['pull', ...own, ...flags, ...where],
    repo.path,
  );
  if (step.exitCode !== 0) {
    step.fail(`${label}  ${formatColor('pull failed', 'error')}`);
    return 'failed';
  }
  const after = (await gitExec(['rev-parse', 'HEAD'], repo.path)).stdout.trim();
  if (before === after) {
    step.succeed(`${label}  ${formatColor(`up to date with ${where.join(' ')}`, 'success')}`);
    return 'current';
  }
  step.succeed(`${label}  ${(await describePull(before, after, repo.path)).join('\n')}`);
  return 'done';
};

/**
 * The repository's own push — everything `git push` does, with giti's checks in front of it:
 * nothing to send is said rather than pushed, and a push upstream would reject as
 * non-fast-forward is refused up front unless it is forced. A branch that tracks nothing yet is
 * pushed to `origin` (or the named remote) under its own name and set to track it.
 */
const pushSelf = async (
  repo: MegaRepo,
  args: VendoredArgs,
  target: TransferTarget = {},
): Promise<VendoredOutcome> => {
  //? The repository is pushed by a plain `git push`, so every flag the user typed is one it
  //? understands: `--no-verify`, `--force-with-lease`, `--tags`, `--push-option=` all land unchanged.
  const label = vendoredLabel('self');
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');
  const where = targetArgs(target);
  const forced = flags.some(isForce);
  const tags = flags.includes('--tags') || flags.includes('--follow-tags');
  const trial = isDryRun(flags) ? ' (dry run)' : '';
  const { upstream, ahead, behind } = await getMegaSelfState(repo.path);

  //? Run as a clack step, as the pull is: git's progress live while it works, then one line
  //? saying what moved — the refs git reports — instead of everything it printed
  const push = async (title: string, command: string[]) => {
    const step = await runGitStep(`${label}  ${title}${trial}`, command, repo.path);
    if (step.exitCode !== 0) {
      step.fail(`${label}  ${formatColor('push failed', 'error')}`);
      return 'failed' as const;
    }
    const done = trial ? 'would push' : 'pushed';
    step.succeed([`${label}  ${formatColor(`${done} ${title}`, 'success')}`, ...describePush(step.output)].join('\n'));
    return 'done' as const;
  };

  //? Named remote/branch: pushed as named — the tracking branch says nothing about them
  if (where.length > 0 && upstream) {
    return push(`to ${where.join(' ')}`, ['push', ...flags, ...where]);
  }

  if (!upstream) {
    const branch = repo.branch && repo.branch !== 'HEAD' ? repo.branch : '';
    if (!branch) {
      stepProgress.log.warn(`${label}  ${formatColor('skipped', 'warning')} · detached HEAD — switch to a branch to push it.`);
      return 'skipped';
    }
    //? The usual first push, `git push -u origin <branch>`: without it a new branch could only
    //? ever be sent by hand
    const remote = target.remote ?? 'origin';
    const into = target.branch ?? branch;
    return push(
      `${branch} to ${remote}/${into}, set as its upstream (it tracked nothing yet)`,
      ['push', '--set-upstream', ...flags, remote, `${branch}:${into}`],
    );
  }

  if (ahead === 0 && !tags && !forced) {
    stepProgress.log.success(`${label}  ${formatColor('nothing to push', 'success')} · ${upstream} already has it all`);
    return 'current';
  }

  if (behind && behind > 0 && !forced) {
    stepProgress.log.warn(
      `${label}  ${formatColor('skipped', 'warning')} · ${upstream} moved ${plural(behind, 'commit')}, so the ` +
        'push would be rejected as non-fast-forward. Run `giti receive` first, or pass --force-with-lease.',
    );
    return 'skipped';
  }

  //? `git push --tags` sends every tag and *only* tags — the branch stays where it is, as it does
  //? for git itself; --follow-tags is the one that sends the branch with its annotated tags
  const what = flags.includes('--tags')
    ? 'every tag (not the branch — that is --follow-tags)'
    : ahead
      ? plural(ahead, 'commit')
      : 'HEAD';
  return push(`${what} to ${upstream}${forced ? ' (forced)' : ''}`, ['push', ...flags]);
};

/** Tally across every group, so a run over a whole tree ends on one line. */
const tallyTree = (outcomes: VendoredOutcome[], verb: string) => {
  const count = (outcome: VendoredOutcome) => outcomes.filter((one) => one === outcome).length;
  const left = count('skipped') + count('failed');
  const done = `${verb} ${count('done')}, already current ${count('current')}`;
  return { text: left > 0 ? `${done}, ${left} left alone.` : `${done}.`, left };
};

const summariseTree = (outcomes: VendoredOutcome[], verb: string) => {
  const { text, left } = tallyTree(outcomes, verb);
  return left > 0 ? `\n⚠️  ${text}` : `\n✅ ${text}`;
};

type Transfer = (entry: Vendored, cwd: string, args: VendoredArgs) => Promise<VendoredOutcome>;

/**
 * The shape `receive` and `send` share: the repository itself on one side of the vendored
 * groups, every group run through the same per-entry body, and one tally at the end.
 *
 * The arguments are split once here and handed down whole: every command this fans out to gets
 * the same flags the user typed, so `--no-verify` on a `send` means "skip the hooks" for the
 * repository and for all three mechanisms, not for whichever of them git happens to run last.
 *
 * @param selfFirst - Whether the repository is handled before its vendored directories
 */
const runMegaTransfer = async (
  tree: MegaTree,
  cwd: string,
  rawArgs: string[],
  transfer: Transfer,
  {
    command,
    verb,
    selfFirst,
    self,
  }: {
    /** The command's name, for the frame's title — `receive` or `send`. */
    command: string;
    verb: string;
    selfFirst: boolean;
    self: (args: VendoredArgs) => Promise<VendoredOutcome>;
  },
) => {
  //? One clack frame for the whole run — `┌` title and the repo header, then the spinner on the
  //? step at hand while each finished one is logged above it as a line labelled with its kind,
  //? `└` tally — the same for a pull and a push, since both bodies report through `stepProgress`
  intro(formatColor(`giti ${command}`, 'command'));
  stepProgress.log.message(formatMegaHeaderLines(tree.repo));

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.transfer);
  let groups = select(tree, args.dirs);
  const selected = countEntries(groups);
  const withSelf = !hasOwn(args, '--no-self');

  if (selected === 0 && !withSelf) {
    stepProgress.log.info(explainEmptyTree(tree, args.dirs).replace(/^ℹ️\s*/, ''));
    stepProgress.outro(formatColor('Nothing to do.', 'info'));
    return;
  }

  const outcomes: VendoredOutcome[] = [];

  const runSelf = async () => {
    if (!withSelf) return;
    stepProgress.working(`${vendoredLabel('self')}  checking against its upstream`);
    outcomes.push(await self(args));
  };

  if (selfFirst) {
    await runSelf();
    //? The tree was read before the repository's own pull, and that pull can move exactly what
    //? the entries record — a `.gitrepo` commit, a gitlink — so every entry would still be
    //? measured from where it *was*: a subrepo the pull already brought current got announced as
    //? "pulling 2 commits", then counted as pulled once `git subrepo pull` found nothing to do.
    //? Re-read only when that pull actually moved HEAD; the directories picked are unchanged.
    if (outcomes.at(-1) === 'done') {
      stepProgress.working('re-reading the tree after the pull');
      const fresh = await getMegaTree(tree.repo.path);
      if (fresh) groups = select(fresh, args.dirs);
    }
  }

  for (const group of groups) {
    if (group.entries.length === 0) continue;

    if (!(await hasVendorTooling(group.kind))) continue;

    for (const entry of group.entries) {
      stepProgress.working(`${vendoredLabel(entry.kind, entry.dir)}  checking against its upstream`);
      outcomes.push(await transfer(entry, cwd, args));
    }
  }

  if (!selfFirst) await runSelf();

  if (selected === 0) stepProgress.log.info(explainEmptyTree(tree, args.dirs).replace(/^ℹ️\s*/, ''));

  const movedSubmodule = groups.some((group) => group.kind === 'submodule' && group.entries.length);
  const gitlinkNote =
    verb === 'Pulled' && movedSubmodule && outcomes.includes('done')
      ? 'The parent repo now has updated gitlinks — commit them to keep the move.'
      : '';

  //? The note comes before the tally so the frame still closes on the one line that says how
  //? the run went.
  if (gitlinkNote) stepProgress.log.info(gitlinkNote);
  const { text, left } = tallyTree(outcomes, verb);
  stepProgress.outro(formatColor(text, left > 0 ? 'warning' : 'success'));
};

/**
 * `receive [<remote> [<branch>]] [<dir>...] [--no-self] [git pull flags]`: bring the whole tree up
 * to its upstreams — the repository, then every subrepo, submodule and subtree in it.
 */
export const runMegaPull = (
  tree: MegaTree,
  cwd: string,
  args: string[],
  target: TransferTarget = {},
) =>
  //? The repository first: its own pull is what moves the pins and `.gitmodules` entries that
  //? every vendored directory below is then measured against.
  runMegaTransfer(tree, cwd, args, pullVendored, {
    command: 'receive',
    verb: 'Pulled',
    selfFirst: true,
    self: (own) => pullSelf(tree.repo, own, target),
  });

/**
 * `send [<remote> [<branch>]] [<dir>...] [--no-self] [git push flags]`: send the whole tree's local
 * work upstream — every subrepo, submodule and subtree, then the repository.
 */
export const runMegaPush = (
  tree: MegaTree,
  cwd: string,
  args: string[],
  target: TransferTarget = {},
) =>
  //? The repository last: it records which upstream commit each copy sits on, and publishing that
  //? before the copies themselves would point everyone at commits no remote has yet.
  runMegaTransfer(tree, cwd, args, pushVendored, {
    command: 'send',
    verb: isDryRun(args) ? 'Would push' : 'Pushed',
    selfFirst: false,
    self: (own) => pushSelf(tree.repo, own, target),
  });

/** `mega/diff [<dir>...] [--stat] [--no-self]`: everything this tree has that its upstreams do not. */
export const runMegaDiff = async (tree: MegaTree, cwd: string, rawArgs: string[]) => {
  console.log(formatMegaHeader(tree.repo));

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.diff);
  const groups = select(tree, args.dirs);
  const selected = countEntries(groups);
  const withSelf = !hasOwn(args, '--no-self');

  if (selected === 0 && !withSelf) {
    console.log(`\n${explainEmptyTree(tree, args.dirs)}`);
    return;
  }

  //? Every comparison here is a `git diff`, so the flags go through untouched: `--stat`, `-p`,
  //? `--name-only`, `-U5` shape the repository's own diff and every vendored one alike.
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');

  if (withSelf) {
    const { upstream } = await getMegaSelfState(tree.repo.path, { fetch: false });
    if (!upstream) {
      console.log(`\nℹ️  (this repo): tracks no upstream branch — nothing to compare against.`);
    } else {
      console.log(`\n=== (this repo) — ${tree.repo.branch} vs ${formatArg(upstream)} ===`);
      //? Three dots: what this branch added since they parted, not every change on either side.
      //? A two-dot diff here would also list upstream's own commits, inverted, as local work.
      await gitExec(['diff', ...flags, `${upstream}...HEAD`], tree.repo.path, { stream: true });
    }
  }

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    console.log(heading(group));
    for (const entry of group.entries) await printVendoredDiff(entry, cwd, flags);
  }

  if (selected === 0) console.log(`\n${explainEmptyTree(tree, args.dirs)}`);
};

/** `mega/clean [--dry-run]`: collect what all three mechanisms abandoned in `.git`. */
export const runMegaClean = async (tree: MegaTree, cwd: string, rawArgs: string[]) => {
  console.log(formatMegaHeader(tree.repo));

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.clean);
  const dryRun = hasOwn(args, '--dry-run', '-n');
  let removed = 0;

  //? `git subrepo clean --all` is the only real git command in the whole run — everything else is
  //? giti deleting refs and directories itself — so it is the only place a flag can land, and
  //? saying so once beats repeating it under all three headings.
  const { flags, dropped } = forwardVendoredFlags(args.passthrough, 'subrepo');
  if (dropped.length > 0) console.warn(`\n${explainDroppedFlags(dropped, 'subrepo')}`);

  for (const { kind } of tree.groups) {
    console.log(`\n${formatColor(`${kind}s`, 'catalog')}`);
    const report = await cleanVendored(kind, cwd, { dryRun, forward: flags });
    printVendoredClean(report, dryRun, INDENT);
    removed += report.removed.length;
  }

  //? Nothing here touches a working tree: every path collected is git bookkeeping the mechanism
  //? itself left behind, so the vendored directories on disk are exactly as they were.
  const verb = dryRun ? 'would be removed' : 'removed';
  console.log(`\n${formatColor(`${plural(removed, 'leftover')} ${verb}`, 'info')}`);
  console.log(formatColor('No vendored directory was touched.', 'info'));
};

/** Extract commit message flags (-m, --message, -F, --file) from giti's own args. */
const extractMessageFlags = (own: string[]): string[] => {
  const flags: string[] = [];
  for (let i = 0; i < own.length; i++) {
    const item = own[i];
    if (item === '-m' || item === '--message' || item === '-F' || item === '--file') {
      const val = own[++i];
      if (val !== undefined) flags.push(item, val);
    } else if (
      item?.startsWith('-m=') ||
      item?.startsWith('--message=') ||
      item?.startsWith('-F=') ||
      item?.startsWith('--file=')
    ) {
      flags.push(item);
    }
  }
  return flags;
};

/** Commit inside one submodule's working tree. */
const commitSubmodule = async (
  entry: Vendored,
  commitFlags: string[],
  allowsEmptyOrAmend: boolean,
): Promise<VendoredOutcome> => {
  const dirty = await getDirtyPaths(entry.path);
  const staged = await gitExec(['diff', '--cached', '--name-only'], entry.path);
  const hasChanges = dirty.length > 0 || Boolean(staged.stdout.trim());

  if (!hasChanges && !allowsEmptyOrAmend) {
    console.log(`   ${entry.dir}: nothing to commit — working tree is clean`);
    return 'current';
  }

  //? Stage all changes (including untracked and modified files) before committing so the commit
  //? captures the full working tree.
  if (dirty.length > 0) {
    await gitExec(['add', '-A'], entry.path);
  }

  console.log(`💾 ${entry.dir}: committing...`);
  const result = await gitExec(['commit', ...commitFlags], entry.path, { stream: true });

  if (result.exitCode === 0) return 'done';
  console.error(`❌ ${entry.dir}: commit failed.`);
  return 'failed';
};

/** Report dirty files in subrepo/subtree directories that will be committed with the parent repo. */
const checkEmbeddedVendored = async (entry: Vendored, cwd: string): Promise<VendoredOutcome> => {
  const dirty = await getDirtyPaths(cwd, entry.dir);
  if (dirty.length === 0) {
    console.log(`   ${entry.dir}: nothing to commit — working tree is clean`);
    return 'current';
  }

  console.log(
    `ℹ️  ${entry.dir}: ${plural(dirty.length, 'uncommitted file')} — will be recorded in the parent repository commit`,
  );
  return 'done';
};

/** The repository's own commit, skipped when it has nothing uncommitted. */
const commitSelf = async (
  repo: MegaRepo,
  commitFlags: string[],
  allowsEmptyOrAmend: boolean,
): Promise<VendoredOutcome> => {
  const dirty = await getDirtyPaths(repo.path);
  const staged = await gitExec(['diff', '--cached', '--name-only'], repo.path);
  const hasChanges = dirty.length > 0 || Boolean(staged.stdout.trim());

  if (!hasChanges && !allowsEmptyOrAmend) {
    console.log('   (this repo): nothing to commit — working tree is clean');
    return 'current';
  }

  //? Stage any modified files and updated submodule gitlinks so the commit records them.
  if (dirty.length > 0) {
    await gitExec(['add', '-A'], repo.path);
  }

  console.log('💾 (this repo): committing...');
  const result = await gitExec(['commit', ...commitFlags], repo.path, { stream: true });

  if (result.exitCode === 0) return 'done';
  console.error('❌ (this repo): commit failed.');
  return 'failed';
};

/** `mega/commit [<dir>...] [--no-self] [-m <msg>]...`: commit uncommitted work across every context. */
export const runMegaCommit = async (tree: MegaTree, cwd: string, rawArgs: string[]) => {
  console.log(formatMegaHeader(tree.repo));

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.commit);

  //? Tell directory targets apart from a positional commit message: any positional matching a
  //? known vendored directory narrows the run; everything else is read as message text.
  const knownDirs = new Set(
    tree.groups.flatMap((group) => group.entries.map((entry) => entry.dir)),
  );
  const targetDirs: string[] = [];
  const messageParts: string[] = [];

  for (const positional of args.dirs) {
    if (knownDirs.has(positional)) targetDirs.push(positional);
    else messageParts.push(positional);
  }

  const groups = select(tree, targetDirs);
  const selected = countEntries(groups);
  const withSelf = !hasOwn(args, '--no-self');

  if (selected === 0 && !withSelf) {
    console.log(`\n${explainEmptyTree(tree, targetDirs)}`);
    return;
  }

  const messageFlags = extractMessageFlags(args.own);
  if (messageFlags.length === 0 && messageParts.length > 0) {
    messageFlags.push('-m', messageParts.join(' '));
  }

  const { flags } = forwardVendoredFlags(args.passthrough, 'git');
  const allowsEmptyOrAmend = flags.some(
    (f) => f === '--allow-empty' || f === '--amend' || f === '--no-edit',
  );

  if (messageFlags.length === 0 && !allowsEmptyOrAmend) {
    if (process.stdin.isTTY) {
      const input = await text({
        message: 'Commit message:',
        placeholder: 'Commit message for all modified contexts',
      });
      if (isCancel(input) || !String(input).trim()) {
        console.log('Cancelled.');
        return;
      }
      messageFlags.push('-m', String(input).trim());
    } else {
      console.error(
        '❌ Please supply a commit message (e.g. `giti mega commit "message"` or `-m "message"`).',
      );
      return;
    }
  }

  const commitFlags = [...messageFlags, ...flags];
  const outcomes: VendoredOutcome[] = [];

  //? Submodules first: committing them moves their HEAD and creates new gitlink records in the
  //? parent repository, which the parent's commit then captures.
  for (const group of groups) {
    if (group.entries.length === 0) continue;

    console.log(heading(group));
    for (const entry of group.entries) {
      if (group.kind === 'submodule') {
        outcomes.push(await commitSubmodule(entry, commitFlags, allowsEmptyOrAmend));
      } else {
        outcomes.push(await checkEmbeddedVendored(entry, cwd));
      }
    }
  }

  if (withSelf) {
    console.log(`\n${formatColor('this repository', 'catalog')}`);
    outcomes.push(await commitSelf(tree.repo, commitFlags, allowsEmptyOrAmend));
  }

  if (selected === 0 && targetDirs.length > 0) {
    console.log(`\n${explainEmptyTree(tree, targetDirs)}`);
  }
  console.log(summariseTree(outcomes, 'Committed'));

  const movedSubmodule = groups.some((group) => group.kind === 'submodule' && group.entries.length);
  if (!withSelf && movedSubmodule && outcomes.includes('done')) {
    console.log('ℹ️  The parent repo now has updated gitlinks — commit them to keep the move.');
  }
};

import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import cleanVendored, { type VendoredCleanReport } from '../cleanVendored';
import getVendoredState from '../getVendoredState';
import isSubrepoUsable from '../isSubrepoUsable';
import pullVendored from '../pullVendored';
import pushVendored from '../pushVendored';
import resolveSubtreeUpstream from '../resolveSubtreeUpstream';
import type { Vendored, VendoredOutcome, VendoredState, VendorKind } from '../vendored';
import { explainEmptySelection, plural, selectVendored } from '../vendored';
import type { VendoredArgs } from '../vendoredArgs';
import splitVendoredArgs, {
  explainDroppedFlags,
  forwardVendoredFlags,
  hasOwn,
} from '../vendoredArgs';
import gitExec from '../gitExec';

/**
 * Bodies shared by the subrepo, submodule and subtree command families.
 *
 * The three mechanisms differ in how a directory is vendored and in the git commands that move it,
 * but "which ones are there", "where do they stand" and "what do we have that upstream does not"
 * are the same questions with the same answers, so they get one implementation and — the point of
 * sharing them — one signature.
 */

const pad = (entries: Vendored[]) => Math.max(...entries.map((e) => e.dir.length));

/**
 * The flags giti reads itself, per operation, so everything else can be forwarded to git.
 *
 * Deliberately short lists: `--squash` is absent because both `git subrepo` and `git subtree`
 * take it themselves, and passing it on is more faithful than re-inventing it. `--remote=` and
 * `--branch=` stay here because they answer "which upstream is this subtree's?", a question git
 * subtree spells differently on its own command line.
 */
export const OWN_FLAGS = {
  status: ['--no-fetch', '--no-self', '--remote=', '--branch='],
  transfer: ['--no-self', '--remote=', '--branch='],
  diff: ['--no-self'],
  clean: ['--dry-run', '-n'],
  commit: ['--no-self', '-m=', '--message=', '-F=', '--file='],
} as const;

interface PrintVendoredStatusOptions {
  /** Contact the remote. Without it "behind" would be a stale guess, so it is left unsaid. */
  fetch?: boolean;
  /** Passthrough flags for the fetch, so `--prune`/`--depth=` reach it like any other git call. */
  forward?: string[];
  /** Column width for the directory names; measured from the entries when not given. */
  width?: number;
  /** Prefix for every line, so rows can sit under a heading. */
  indent?: string;
}

/**
 * Moving a submodule changes a gitlink in the parent's index, which is a change the parent still
 * has to record — an update that is never committed silently reverts on the next checkout.
 */
const GITLINK_NOTE = 'ℹ️  The parent repo now has updated gitlinks — commit them to keep the move.';

/** Tally for the line a pull or push ends on. */
const summarise = (outcomes: VendoredOutcome[], verb: string) => {
  const count = (outcome: VendoredOutcome) => outcomes.filter((o) => o === outcome).length;
  const failed = count('failed') + count('skipped');
  const done = `${verb} ${count('done')}, already current ${count('current')}`;
  return failed > 0 ? `⚠️  ${done}, ${failed} left alone.` : `✅ ${done}.`;
};

/**
 * Fill in the upstream `git subtree` never wrote down, for the reads that need one.
 *
 * `pull` and `push` recover it per entry because they need it to build their command anyway;
 * `status` needs it only to have something to compare against, and without it can report nothing
 * but "remote not recorded".
 *
 * @param targets - Entries about to be reported on
 * @param kind - Which mechanism they came from; the other two already know their upstream
 * @param cwd - Any directory inside the parent repository
 * @param args - Split arguments, read for an explicit `--remote=`/`--branch=`
 * @returns The same entries, subtrees among them filled in where an upstream could be recovered
 */
export const withSubtreeUpstream = async (
  targets: Vendored[],
  kind: VendorKind,
  cwd: string,
  args: VendoredArgs,
) => {
  if (kind !== 'subtree') return targets;
  return Promise.all(
    targets.map(async (entry) => ({
      ...entry,
      ...((await resolveSubtreeUpstream(entry, args, cwd)) ?? {}),
    })),
  );
};

/** One `list` row: where it is, what it is pinned to, and where that came from. */
export const formatVendoredLine = ({ dir, remote, branch, commit }: Vendored, width: number) => {
  const pin = commit ? formatArg(commit.slice(0, 7)) : formatColor('unpinned', 'warning');
  const where = remote || formatColor('remote not recorded', 'warning');
  return `${dir.padEnd(width)}  ${pin}  ${branch || '(default)'}  ${where}`;
};

/** `list`: everything the discovery step found, without touching the network. */
export const runVendoredList = (all: Vendored[], kind: Vendored['kind']) => {
  if (all.length === 0) {
    console.log(`ℹ️  No ${kind}s here.`);
    return;
  }

  const width = pad(all);
  for (const entry of all) console.log(formatVendoredLine(entry, width));
};

/** One-line verdict plus the command that would resolve it. */
export const describeVendored = (
  { vendored, behind, localChanges, ahead, gitlinkBehind }: VendoredState,
  kind: Vendored['kind'],
  fetched: boolean,
) => {
  const notes: string[] = [];

  //? With --no-fetch there is nothing to say about upstream: `behind` is null because it was
  //? never asked, which is not the same as a remote that failed to answer — and neither is a
  //? subtree, whose upstream URL `git subtree` never writes down anywhere.
  if (fetched) {
    if (!vendored.remote) notes.push('remote not recorded — pass --remote=');
    else if (behind === null) notes.push('upstream unreachable');
    else if (behind > 0) notes.push(`${plural(behind, 'commit')} behind`);
  }

  //? A submodule's copy is a repository, so what it has that others do not is commits, in two
  //? independent places: unpushed ones in the submodule, and ones the parent's pointer has not
  //? caught up with. A count of differing files answers neither and reads as work to push.
  const gitlinkStale = gitlinkBehind !== null && gitlinkBehind > 0;
  if (kind === 'submodule') {
    if (ahead !== null && ahead > 0) notes.push(`${plural(ahead, 'commit')} to push`);
    if (gitlinkBehind === null) notes.push('local state unknown');
    else if (gitlinkStale) notes.push(`parent gitlink ${plural(gitlinkBehind, 'commit')} behind`);
  } else if (localChanges === null) notes.push('local state unknown');
  else if (localChanges.length > 0) notes.push(plural(localChanges.length, 'local change'));

  if (notes.length === 0) {
    return { label: formatColor(fetched ? 'up to date' : 'no local changes', 'success'), hint: '' };
  }

  const wantsPull = behind !== null && behind > 0;
  const wantsPush =
    kind === 'submodule'
      ? ahead !== null && ahead > 0
      : localChanges !== null && localChanges.length > 0;

  //? Ordered the way they have to happen: merge upstream in, send our own commits, then record
  //? where the submodule ended up — a gitlink committed any earlier pins a commit that then moves.
  const actions: string[] = [];
  if (wantsPull) actions.push(`giti ${kind}/pull ${vendored.dir}`);
  if (wantsPush) actions.push(`giti ${kind}/push ${vendored.dir}`);
  if (gitlinkStale) actions.push('commit the moved gitlink in the parent');

  const tone = actions.length > 0 ? 'warning' : 'error';
  return { label: formatColor(notes.join(', '), tone), hint: actions.join(', then ') };
};

/**
 * The rows `status` prints, without the framing — so a caller listing several mechanisms at once
 * can line their columns up with each other and indent them under a heading.
 *
 * @param targets - Entries to report on
 * @param kind - Which mechanism they came from
 * @param cwd - Any directory inside the parent repository
 * @param options - Whether to fetch, and how to lay the rows out
 */
export const printVendoredStatus = async (
  targets: Vendored[],
  kind: VendorKind,
  cwd: string,
  { fetch = true, forward = [], width = 0, indent = '' }: PrintVendoredStatusOptions = {},
) => {
  const states = await Promise.all(
    targets.map((entry) => getVendoredState(entry, cwd, { fetch, forward })),
  );
  const columns = width || pad(targets);

  for (const state of states) {
    const { label, hint } = describeVendored(state, kind, fetch);
    console.log(
      `${indent}${state.vendored.dir.padEnd(columns)}  ${label}${hint ? `  → ${hint}` : ''}`,
    );

    if (state.dirty.length > 0) {
      const note = `${plural(state.dirty.length, 'uncommitted file')} — commit or stash first`;
      console.log(`${indent}${' '.repeat(columns)}  ${formatColor(note, 'warning')}`);
    }
  }

  return states;
};

/** `status [<dir>...] [--no-fetch]`: where each entry stands against its real upstream. */
export const runVendoredStatus = async (
  all: Vendored[],
  kind: Vendored['kind'],
  cwd: string,
  rawArgs: string[],
) => {
  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.status);
  const targets = await withSubtreeUpstream(selectVendored(all, args.dirs), kind, cwd, args);
  if (targets.length === 0) {
    console.log(explainEmptySelection(kind, all, args.dirs));
    return;
  }

  const noFetch = hasOwn(args, '--no-fetch');
  if (!noFetch) console.log(`🔄 Fetching ${plural(targets.length, kind)}...`);

  //? The only git this command runs is a fetch, so that is where the user's own flags belong.
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');
  await printVendoredStatus(targets, kind, cwd, { fetch: !noFetch, forward: flags });

  if (noFetch) console.log(formatColor('\n--no-fetch: upstream was not checked.', 'info'));
};

/** One `diff` comparison: this copy against the upstream commit it is pinned to. */
export const printVendoredDiff = async (
  { kind, dir, path, commit }: Vendored,
  cwd: string,
  forward: string[] = [],
) => {
  if (!commit) {
    console.error(`❌ ${dir}: no pinned upstream commit recorded.`);
    return;
  }

  console.log(`\n=== ${dir} — vendored copy vs ${formatArg(commit.slice(0, 7))} ===`);

  //? A submodule keeps its own history, so the comparison runs inside it. The others live in
  //? the parent's tree, where `.gitrepo` is excluded: it exists only on this side and would
  //? otherwise show up as a difference on every single entry.
  const [diffArgs, diffCwd]: [string[], string] =
    kind === 'submodule'
      ? [[commit, 'HEAD'], path]
      : [[commit, `HEAD:${dir}`, '--', '.', ':(exclude).gitrepo'], cwd];

  //? Flags before the revisions: `git diff` stops reading options at the first one, and the
  //? non-submodule form ends in a pathspec after `--`.
  const result = await gitExec(['diff', ...forward, ...diffArgs], diffCwd, {
    stream: true,
  });

  if (result.exitCode !== 0) {
    console.error(
      `❌ ${dir}: cannot diff — ${commit.slice(0, 7)} is not in this repository. ` +
        `Run \`giti ${kind}/status\` to fetch it.`,
    );
  }
};

/** `diff [<dir>...]`: what this copy has that its pinned upstream commit does not. */
export const runVendoredDiff = async (
  all: Vendored[],
  kind: Vendored['kind'],
  cwd: string,
  rawArgs: string[],
) => {
  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.diff);
  const targets = selectVendored(all, args.dirs);
  if (targets.length === 0) {
    console.log(explainEmptySelection(kind, all, args.dirs));
    return;
  }

  //? Every flag goes straight to `git diff` — `--stat`, `-p`, `--name-only`, `-U5` and the rest
  //? behave here exactly as they do on a plain diff.
  const { flags } = forwardVendoredFlags(args.passthrough, 'git');
  for (const entry of targets) await printVendoredDiff(entry, cwd, flags);
};

/**
 * Refuse early when the mechanism's own tooling is missing.
 *
 * Only git-subrepo is an extra install; submodules and subtrees ship with git. Its own docs
 * promise that consumers of a repo never need it, which is why discovery reads `.gitrepo` files
 * directly — but moving a subrepo genuinely does need the subcommand.
 */
export const hasVendorTooling = async (kind: VendorKind) => {
  if (kind !== 'subrepo' || (await isSubrepoUsable())) return true;
  console.error('❌ git-subrepo is not installed. Run `giti subrepo/install` first.');
  return false;
};

/** `pull [<dir>...]`: bring every entry that actually moved upstream up to date. */
export const runVendoredPull = async (
  all: Vendored[],
  kind: VendorKind,
  cwd: string,
  rawArgs: string[],
) => {
  if (!(await hasVendorTooling(kind))) return [];

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.transfer);
  const targets = selectVendored(all, args.dirs);
  if (targets.length === 0) {
    console.log(explainEmptySelection(kind, all, args.dirs));
    return [];
  }

  console.log(`🔄 Checking ${plural(targets.length, kind)}...`);

  const outcomes: VendoredOutcome[] = [];
  for (const entry of targets) outcomes.push(await pullVendored(entry, cwd, args));

  console.log(summarise(outcomes, 'Pulled'));
  if (kind === 'submodule' && outcomes.includes('done')) console.log(GITLINK_NOTE);

  return outcomes;
};

/** `push [<dir>...]`: send local work back upstream, refusing the pushes that would fail. */
export const runVendoredPush = async (
  all: Vendored[],
  kind: VendorKind,
  cwd: string,
  rawArgs: string[],
) => {
  if (!(await hasVendorTooling(kind))) return [];

  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.transfer);
  const targets = selectVendored(all, args.dirs);
  if (targets.length === 0) {
    console.log(explainEmptySelection(kind, all, args.dirs));
    return [];
  }

  const outcomes: VendoredOutcome[] = [];
  for (const entry of targets) outcomes.push(await pushVendored(entry, cwd, args));

  console.log(summarise(outcomes, 'Pushed'));
  return outcomes;
};

/** `clean [--dry-run]`: collect what the mechanism abandoned in `.git`. */
export const runVendoredClean = async (kind: VendorKind, cwd: string, rawArgs: string[]) => {
  const args = splitVendoredArgs(rawArgs, OWN_FLAGS.clean);
  const dryRun = hasOwn(args, '--dry-run', '-n');

  //? The only mechanism with a cleaner of its own is git-subrepo, so that is the one command line
  //? a forwarded flag can land on; the rest of the work is giti deleting refs and directories.
  const { flags, dropped } = forwardVendoredFlags(args.passthrough, 'subrepo');
  if (kind === 'subrepo' && dropped.length > 0) {
    console.warn(explainDroppedFlags(dropped, 'subrepo'));
  }

  const report = await cleanVendored(kind, cwd, { dryRun, forward: flags });

  printVendoredClean(report, dryRun);
  return report;
};

/** The report `clean` produces, printed the same way whether one mechanism ran or all three. */
export const printVendoredClean = (
  { kind, removed, notes }: VendoredCleanReport,
  dryRun: boolean,
  indent = '',
) => {
  for (const note of notes) console.log(`${indent}ℹ️  ${note}`);

  if (removed.length === 0) {
    console.log(`${indent}✨ Nothing to clean for ${kind}s.`);
    return;
  }

  for (const path of removed) console.log(`${indent}  - ${path}`);
  const verb = dryRun ? 'would remove' : 'Removed';
  console.log(
    `${indent}${dryRun ? 'ℹ️  --dry-run: ' : '🧹 '}${verb} ${plural(removed.length, `${kind} leftover`)}.`,
  );
};

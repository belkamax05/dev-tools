/**
 * Splitting a vendored command's argv into the part giti acts on and the part git gets.
 *
 * Every one of these commands ends in a real git invocation, so anything the user typed that giti
 * has no opinion about has to arrive there unchanged: `--no-verify` on a push means "skip the
 * hooks" for *every* push the run makes, not only the ones giti happens to build itself. Only the
 * handful of flags giti reads to decide what to do — `--no-self`, `--no-fetch`, `--remote=` — are
 * held back; everything else is forwarded.
 *
 * The three mechanisms cannot all take the same flags, though: `git subrepo` and `git subtree`
 * parse their own option lists and die on anything outside them, so forwarding blindly would turn
 * `--no-verify` into "error: unknown option". So a flag is forwarded when the target command line
 * accepts it, delivered as configuration when it does not but git config can still produce the
 * same effect, and reported when neither is possible — never silently dropped.
 */

/** Which command line a forwarded flag will actually land on. */
export type FlagTarget = 'git' | 'submodule-update' | 'subrepo' | 'subtree';

export interface VendoredArgs {
  /** Positionals: the vendored directories the command was pointed at. */
  dirs: string[];
  /** Flags giti reads and acts on itself, with their values. Never forwarded. */
  own: string[];
  /** Everything else the user typed, bound for the git command that actually runs. */
  passthrough: string[];
}

export interface ForwardedFlags {
  /** Appended to the command's own arguments. */
  flags: string[];
  /** `-c key=value` pairs, placed before the subcommand so child git processes inherit them. */
  config: string[];
  /** Flags this target can express no way at all, kept so the caller can say so out loud. */
  dropped: string[];
}

/** `git subrepo`'s own option list — anything else makes it exit with "unknown option". */
const SUBREPO_FLAGS = new Set([
  '-a',
  '--all',
  '-A',
  '--ALL',
  '-b',
  '--branch',
  '-e',
  '--edit',
  '-f',
  '--force',
  '-F',
  '--fetch',
  '-M',
  '--method',
  '-m',
  '--message',
  '--file',
  '-r',
  '--remote',
  '-s',
  '--squash',
  '-u',
  '--update',
  '-q',
  '--quiet',
  '-v',
  '--verbose',
  '-d',
  '--debug',
  '-x',
  '--DEBUG',
]);

/** `git subtree`'s option list for the `pull`/`push` forms. */
const SUBTREE_FLAGS = new Set([
  '-q',
  '--quiet',
  '-d',
  '--debug',
  '--annotate',
  '-b',
  '--branch',
  '--ignore-joins',
  '--onto',
  '--rejoin',
  '--squash',
  '-m',
  '--message',
  '-S',
  '--gpg-sign',
]);

/** `git submodule update`'s option list, which is not `git pull`'s. */
const SUBMODULE_UPDATE_FLAGS = new Set([
  '--init',
  '--remote',
  '--no-fetch',
  '-N',
  '--merge',
  '--rebase',
  '--checkout',
  '-f',
  '--force',
  '--recursive',
  '--depth',
  '-j',
  '--jobs',
  '--single-branch',
  '--no-single-branch',
  '--reference',
  '--filter',
  '--require-init',
  '-q',
  '--quiet',
  '--progress',
  '--no-recommend-shallow',
  '--recommend-shallow',
]);

const ACCEPTED: Record<Exclude<FlagTarget, 'git'>, Set<string>> = {
  'submodule-update': SUBMODULE_UPDATE_FLAGS,
  subrepo: SUBREPO_FLAGS,
  subtree: SUBTREE_FLAGS,
};

/**
 * Flags a mechanism's own CLI rejects whose effect git configuration can still deliver.
 *
 * `git -c` is exported to every child process through `GIT_CONFIG_PARAMETERS`, so a setting put in
 * front of `git subtree push` also reaches the plain `git push` that the subtree script runs
 * underneath — which is the only way `--no-verify` can be honoured by a mechanism that has no such
 * option. A hooks path that cannot exist is how git is told to run no hooks at all.
 */
const CONFIG_EQUIVALENT: Record<string, string> = {
  '--no-verify': 'core.hooksPath=/dev/null',
};

/** Passthrough flags that decide how a pull integrates, so giti must stop imposing its own. */
const INTEGRATION_FLAGS = new Set([
  '--rebase',
  '-r',
  '--no-rebase',
  '--ff',
  '--no-ff',
  '--ff-only',
  '--squash',
  '--strategy',
  '-s',
  '--autostash',
]);

/** How `git submodule update` is told to move the checkout; only one of them may be given. */
const SUBMODULE_MODE_FLAGS = new Set(['--merge', '--rebase', '--checkout']);

/** The flag itself, with any `=value` cut off. */
const flagName = (arg: string) => arg.split('=')[0] ?? arg;

/**
 * How an argument matches one of giti's own flag specs.
 *
 * A spec ending in `=` takes a value, which the user may write either joined (`--remote=origin`)
 * or separated (`--remote origin`); the separated form has to swallow the next token, or it would
 * be read as a directory name and narrow the run to nothing.
 */
const matchOwn = (arg: string, spec: string): 'flag' | 'value' | null => {
  if (!spec.endsWith('=')) return arg === spec ? 'flag' : null;
  if (arg === spec.slice(0, -1)) return 'value';
  return arg.startsWith(spec) ? 'flag' : null;
};

/**
 * Split raw command arguments into directories, giti's own flags, and everything git should see.
 *
 * `--` ends giti's parsing: every token after it is passthrough, which is the escape hatch for a
 * value-taking git flag written in its separated form (`-- --push-option ci.skip`).
 *
 * @param args - Raw arguments as the command received them
 * @param ownFlags - Flags giti consumes; write value-taking ones with a trailing `=`
 * @returns The three groups, each in the order the user typed them
 */
const splitVendoredArgs = (args: string[], ownFlags: readonly string[] = []): VendoredArgs => {
  const dirs: string[] = [];
  const own: string[] = [];
  const passthrough: string[] = [];

  let verbatim = false;
  let expectingValue = false;

  for (const arg of args) {
    if (verbatim) {
      passthrough.push(arg);
      continue;
    }

    if (expectingValue) {
      own.push(arg);
      expectingValue = false;
      continue;
    }

    if (arg === '--') {
      verbatim = true;
      continue;
    }

    const spec = ownFlags.find((candidate) => matchOwn(arg, candidate) !== null);
    if (spec) {
      own.push(arg);
      expectingValue = matchOwn(arg, spec) === 'value';
      continue;
    }

    if (arg.startsWith('-')) {
      passthrough.push(arg);
      continue;
    }

    dirs.push(arg);
  }

  return { dirs, own, passthrough };
};

/** Whether one of giti's own boolean flags was given. */
export const hasOwn = ({ own }: VendoredArgs, ...names: string[]) =>
  names.some((name) => own.includes(name));

/**
 * The value of one of giti's own value-taking flags, in either the joined or separated form.
 *
 * @param args - A split argument set
 * @param name - Flag name without its dashes, e.g. "remote"
 * @returns The value, or '' when the flag was not given
 */
export const ownValue = ({ own }: VendoredArgs, name: string) => {
  const joined = own.find((arg) => arg.startsWith(`--${name}=`));
  if (joined) return joined.slice(name.length + 3);

  const index = own.indexOf(`--${name}`);
  return index === -1 ? '' : (own[index + 1] ?? '');
};

/**
 * Work out how each passthrough flag reaches a particular git command line.
 *
 * @param passthrough - Flags the user typed that giti has no opinion about
 * @param target - The command line they are bound for
 * @returns Flags to append, `-c` settings to lead with, and what neither could carry
 */
export const forwardVendoredFlags = (passthrough: string[], target: FlagTarget): ForwardedFlags => {
  const flags: string[] = [];
  const settings: string[] = [];
  const dropped: string[] = [];

  for (const arg of passthrough) {
    if (target === 'git' || ACCEPTED[target].has(flagName(arg))) {
      flags.push(arg);
      continue;
    }

    const equivalent = CONFIG_EQUIVALENT[flagName(arg)];
    if (equivalent) {
      if (!settings.includes(equivalent)) settings.push(equivalent);
      continue;
    }

    dropped.push(arg);
  }

  return { flags, config: settings.flatMap((setting) => ['-c', setting]), dropped };
};

/** The warning for flags a mechanism can neither take nor emulate, so nothing vanishes quietly. */
export const explainDroppedFlags = (dropped: string[], target: FlagTarget) =>
  `⚠️  git ${target === 'submodule-update' ? 'submodule update' : target} cannot take ` +
  `${dropped.join(' ')} — it was not forwarded.`;

/** Whether the user already said how a pull should integrate, so `--ff-only` must not be added. */
export const setsIntegration = (passthrough: string[]) =>
  passthrough.some((arg) => INTEGRATION_FLAGS.has(flagName(arg)));

/** Whether the user already chose `git submodule update`'s mode, so `--merge` must not be added. */
export const setsSubmoduleMode = (flags: string[]) =>
  flags.some((arg) => SUBMODULE_MODE_FLAGS.has(flagName(arg)));

export default splitVendoredArgs;

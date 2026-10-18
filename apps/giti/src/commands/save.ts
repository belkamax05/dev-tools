import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { CommandRun } from '../types/CommandRun';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';
import saveCommit from '../utils/saveCommit';

//? Flags the TUI knows how to toggle; everything else is passthrough to git.
//? --yes/-y is a shu-only flag: never forwarded to git, bypasses the TUI.
const KNOWN_FLAGS = new Set([
  '--no-verify',
  '-n',
  '--amend',
  '--allow-empty',
  '--signoff',
  '-s',
  '--push',
  '--yes',
  '-y',
]);

const CommitArgs = z.object({
  noVerify: z.boolean().default(false),
  amend: z.boolean().default(false),
  allowEmpty: z.boolean().default(false),
  signoff: z.boolean().default(false),
  push: z.boolean().default(false),
  yes: z.boolean().default(false),
  message: z.string().optional(),
});

const run: CommandRun = async (rawArgs) => {
  const cwd = getWorkingDir();

  const passthroughFlags = rawArgs.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a));
  const knownArgs = rawArgs.filter((a) => !passthroughFlags.includes(a));

  const { values, positionals } = parseArgs({
    args: knownArgs,
    options: {
      'no-verify': { type: 'boolean', short: 'n' },
      amend: { type: 'boolean' },
      'allow-empty': { type: 'boolean' },
      signoff: { type: 'boolean', short: 's' },
      push: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = CommitArgs.parse({
    noVerify: values['no-verify'],
    amend: values.amend,
    allowEmpty: values['allow-empty'],
    signoff: values.signoff,
    push: values.push,
    yes: values.yes,
    message: positionals.join(' ') || undefined,
  });

  //? Bypass TUI when a message is provided or any flag is set.
  //? --yes is shu-only (never forwarded to git); any other flag makes it irrelevant.
  const hasAnyFlag =
    parsed.noVerify ||
    parsed.amend ||
    parsed.allowEmpty ||
    parsed.signoff ||
    parsed.yes ||
    parsed.push ||
    passthroughFlags.length > 0;

  //? A supplied message still belongs in the combined form when files need staging.
  const staged = await gitExec(['diff', '--cached', '--name-only'], cwd);
  if (staged.exitCode !== 0) throw new Error(staged.stderr);
  const needsStaging = !staged.stdout.trim() && !parsed.allowEmpty && !parsed.amend;
  const selectChanges = needsStaging && process.stdin.isTTY && !parsed.yes;
  if (!selectChanges && (parsed.message || hasAnyFlag || !process.stdin.isTTY)) {
    if (!parsed.allowEmpty && !parsed.amend) {
      if (!staged.stdout.trim()) {
        const status = await getStatus(cwd);
        console.log(
          status.trim()
            ? 'Nothing staged. Run giti save interactively to select changes, or use git add first.'
            : 'ℹ️  Nothing to commit — working tree is clean.',
        );
        return;
      }
    }
    const flags: string[] = [];
    if (parsed.noVerify) flags.push('--no-verify');
    if (parsed.amend) flags.push('--amend');
    if (parsed.allowEmpty) flags.push('--allow-empty');
    if (parsed.signoff) flags.push('--signoff');
    flags.push(...passthroughFlags);

    const args = ['commit', ...flags];
    if (parsed.message) args.push('-m', parsed.message);

    const result = await saveCommit(cwd, args, parsed.push);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
    return;
  }

  const initialFlags: string[] = [];
  if (parsed.noVerify) initialFlags.push('--no-verify');
  if (parsed.amend) initialFlags.push('--amend');
  if (parsed.allowEmpty) initialFlags.push('--allow-empty');
  if (parsed.signoff) initialFlags.push('--signoff');
  if (parsed.push) initialFlags.push('--push');

  const { default: renderInkCommit } = await import('../ui/renderInkCommit');
  await renderInkCommit({
    initialMessage: parsed.message,
    initialFlags,
    passthroughFlags,
    cwd,
  });
};

export const meta = {
  name: 'save',
  description:
    'Commit with interactive TUI for message and flags; select changes, message and flags together; --push sends after success (off by default); message or flags skip TUI when changes are already staged',
};

export default run;

import { parseArgs } from 'node:util';
import { confirm, isCancel } from '@clack/prompts';
import { z } from 'zod';
import type { CommandRun } from '../types/CommandRun';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';
import stageAll from '../utils/stageAll';

//? Flags the TUI knows how to toggle; everything else is passthrough to git.
//? --yes/-y is a shu-only flag: never forwarded to git, bypasses the TUI.
const KNOWN_FLAGS = new Set([
  '--no-verify',
  '-n',
  '--amend',
  '--allow-empty',
  '--signoff',
  '-s',
  '--yes',
  '-y',
]);

const CommitArgs = z.object({
  noVerify: z.boolean().default(false),
  amend: z.boolean().default(false),
  allowEmpty: z.boolean().default(false),
  signoff: z.boolean().default(false),
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
    yes: values.yes,
    message: positionals.join(' ') || undefined,
  });

  if (!parsed.allowEmpty && !parsed.amend) {
    const staged = await gitExec(['diff', '--cached', '--name-only'], cwd);
    if (!staged.stdout.trim()) {
      //? "Nothing staged" is only half the answer, and the useful half is already in hand: either
      //? there is nothing to commit at all, or the files are right there and staging them is the
      //? single step between here and the commit that was asked for.
      const unstaged = (await getStatus(cwd)).split('\n').filter(Boolean);

      if (unstaged.length === 0) {
        console.log('ℹ️  Nothing to commit — working tree is clean.');
        process.exit(0);
      }

      console.log(`Nothing staged, but ${unstaged.length} file(s) have changes:`);
      for (const line of unstaged.slice(0, 10)) console.log(`  ${line}`);
      if (unstaged.length > 10) console.log(`  …and ${unstaged.length - 10} more`);

      if (!process.stdin.isTTY) {
        console.log('\nStage them with `git add -A`, or commit everything with `giti wip`.');
        process.exit(0);
      }

      const stage = await confirm({ message: 'Stage all of them and continue?' });
      if (isCancel(stage) || !stage) {
        console.log('Cancelled — nothing staged.');
        process.exit(0);
      }

      await stageAll(cwd);
      console.log('📦 Staged all changes.');
    }
  }

  //? Bypass TUI when a message is provided or any flag is set.
  //? --yes is shu-only (never forwarded to git); any other flag makes it irrelevant.
  const hasAnyFlag =
    parsed.noVerify ||
    parsed.amend ||
    parsed.allowEmpty ||
    parsed.signoff ||
    parsed.yes ||
    passthroughFlags.length > 0;

  if (parsed.message || hasAnyFlag) {
    const flags: string[] = [];
    if (parsed.noVerify) flags.push('--no-verify');
    if (parsed.amend) flags.push('--amend');
    if (parsed.allowEmpty) flags.push('--allow-empty');
    if (parsed.signoff) flags.push('--signoff');
    flags.push(...passthroughFlags);

    const args = ['commit', ...flags];
    if (parsed.message) args.push('-m', parsed.message);

    const result = await gitExec(args, cwd);
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

  const { default: renderInkCommit } = await import('../ui/renderInkCommit');
  await renderInkCommit({
    initialMessage: parsed.message,
    initialFlags,
    passthroughFlags,
    cwd,
  });
};

export const meta = {
  name: 'commit',
  description:
    'Commit with interactive TUI for message and flags; TUI is skipped when a message or any flag is provided',
};

export default run;

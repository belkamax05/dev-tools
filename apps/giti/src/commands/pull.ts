import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

//? Flags the TUI knows how to handle; everything else is passthrough to git.
//? --yes/-y is a shu-only flag: never forwarded to git, bypasses the TUI.
const KNOWN_FLAGS = new Set([
  '--rebase',
  '--no-rebase',
  '--ff-only',
  '--no-ff',
  '--autostash',
  '--no-commit',
  '--squash',
  '--no-verify',
  '--yes',
  '-y',
]);

const PullArgs = z.object({
  rebase: z.boolean().default(false),
  ffOnly: z.boolean().default(false),
  autostash: z.boolean().default(false),
  noCommit: z.boolean().default(false),
  squash: z.boolean().default(false),
  noVerify: z.boolean().default(false),
  yes: z.boolean().default(false),
  remote: z.string().optional(),
  branch: z.string().optional(),
});

const run: CommandRun = async (rawArgs) => {
  const cwd = getWorkingDir();

  const passthroughFlags = rawArgs.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a));
  const knownArgs = rawArgs.filter((a) => !passthroughFlags.includes(a));

  const { values, positionals } = parseArgs({
    args: knownArgs,
    options: {
      rebase: { type: 'boolean' },
      'no-rebase': { type: 'boolean' },
      'ff-only': { type: 'boolean' },
      'no-ff': { type: 'boolean' },
      autostash: { type: 'boolean' },
      'no-commit': { type: 'boolean' },
      squash: { type: 'boolean' },
      'no-verify': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = PullArgs.parse({
    rebase: values.rebase,
    ffOnly: values['ff-only'],
    autostash: values.autostash,
    noCommit: values['no-commit'],
    squash: values.squash,
    noVerify: values['no-verify'],
    yes: values.yes,
    remote: positionals[0],
    branch: positionals[1],
  });

  //? Bypass TUI when any flag is set; --yes is shu-only and becomes irrelevant when other flags are present.
  const hasAnyFlag =
    parsed.rebase ||
    parsed.ffOnly ||
    parsed.autostash ||
    parsed.noCommit ||
    parsed.squash ||
    parsed.noVerify ||
    parsed.yes ||
    passthroughFlags.length > 0;

  if (hasAnyFlag) {
    const args = ['pull'];
    if (parsed.remote) args.push(parsed.remote);
    if (parsed.branch) args.push(parsed.branch);
    if (parsed.rebase) args.push('--rebase');
    if (parsed.ffOnly) args.push('--ff-only');
    if (parsed.autostash) args.push('--autostash');
    if (parsed.noCommit) args.push('--no-commit');
    if (parsed.squash) args.push('--squash');
    if (parsed.noVerify) args.push('--no-verify');
    args.push(...passthroughFlags);

    const result = await gitExec(args, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
    return;
  }

  const initialFlags: string[] = [];
  if (parsed.rebase) initialFlags.push('--rebase');
  if (parsed.ffOnly) initialFlags.push('--ff-only');
  if (parsed.autostash) initialFlags.push('--autostash');
  if (parsed.noCommit) initialFlags.push('--no-commit');
  if (parsed.squash) initialFlags.push('--squash');
  if (parsed.noVerify) initialFlags.push('--no-verify');

  const { default: renderInkPull } = await import('../ui/renderInkPull');
  await renderInkPull({
    initialRemote: parsed.remote,
    initialBranch: parsed.branch,
    initialFlags,
    passthroughFlags,
    cwd,
  });
};

export const meta = {
  name: 'pull',
  description:
    'Pull with interactive TUI showing incoming commits and conflict strategy options; TUI is skipped when any flag is provided',
};

export default run;

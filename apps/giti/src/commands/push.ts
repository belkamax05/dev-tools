import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

//? Flags the TUI knows how to toggle; everything else is passthrough to git.
//? --yes/-y is a shu-only flag: never forwarded to git, bypasses the TUI.
const KNOWN_FLAGS = new Set([
  '--no-verify',
  '--force-with-lease',
  '--force',
  '-f',
  '--set-upstream',
  '-u',
  '--tags',
  '--dry-run',
  '--yes',
  '-y',
]);

const PushArgs = z.object({
  noVerify: z.boolean().default(false),
  forceWithLease: z.boolean().default(false),
  force: z.boolean().default(false),
  setUpstream: z.boolean().default(false),
  tags: z.boolean().default(false),
  dryRun: z.boolean().default(false),
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
      'no-verify': { type: 'boolean' },
      'force-with-lease': { type: 'boolean' },
      force: { type: 'boolean', short: 'f' },
      'set-upstream': { type: 'boolean', short: 'u' },
      tags: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = PushArgs.parse({
    noVerify: values['no-verify'],
    forceWithLease: values['force-with-lease'],
    force: values.force,
    setUpstream: values['set-upstream'],
    tags: values.tags,
    dryRun: values['dry-run'],
    yes: values.yes,
    remote: positionals[0],
    branch: positionals[1],
  });

  //? Bypass TUI when any flag is set; --yes is shu-only and becomes irrelevant when other flags are present.
  const hasAnyFlag =
    parsed.noVerify ||
    parsed.forceWithLease ||
    parsed.force ||
    parsed.setUpstream ||
    parsed.tags ||
    parsed.dryRun ||
    parsed.yes ||
    passthroughFlags.length > 0;

  if (hasAnyFlag) {
    const args = ['push'];
    if (parsed.remote) args.push(parsed.remote);
    if (parsed.branch) args.push(parsed.branch);
    if (parsed.noVerify) args.push('--no-verify');
    if (parsed.forceWithLease) args.push('--force-with-lease');
    if (parsed.force) args.push('--force');
    if (parsed.setUpstream) args.push('--set-upstream');
    if (parsed.tags) args.push('--tags');
    if (parsed.dryRun) args.push('--dry-run');
    args.push(...passthroughFlags);

    const result = await gitExec(args, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
    return;
  }

  const initialFlags: string[] = [];
  if (parsed.noVerify) initialFlags.push('--no-verify');
  if (parsed.forceWithLease) initialFlags.push('--force-with-lease');
  if (parsed.force) initialFlags.push('--force');
  if (parsed.setUpstream) initialFlags.push('--set-upstream');
  if (parsed.tags) initialFlags.push('--tags');
  if (parsed.dryRun) initialFlags.push('--dry-run');

  const { default: renderInkPush } = await import('../ui/renderInkPush');
  await renderInkPush({
    initialRemote: parsed.remote,
    initialBranch: parsed.branch,
    initialFlags,
    passthroughFlags,
    cwd,
  });
};

export const meta = {
  name: 'push',
  description:
    'Push with interactive TUI for flags and upstream info; TUI is skipped when any flag is provided',
};

export default run;

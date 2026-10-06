import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { CommandRun } from '../types/CommandRun';
import getBranches from '../utils/getBranches';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

const KNOWN_FLAGS = new Set([
  '--new',
  '-c',
  '--detach',
  '-d',
  '--track',
  '-t',
  '--no-track',
  '--force',
  '-f',
  '--discard-changes',
  '--yes',
  '-y',
]);

const SwitchArgs = z.object({
  newBranch: z.boolean().default(false),
  detach: z.boolean().default(false),
  track: z.boolean().default(false),
  noTrack: z.boolean().default(false),
  force: z.boolean().default(false),
  yes: z.boolean().default(false),
  branch: z.string().optional(),
  newBranchName: z.string().optional(),
});

const run: CommandRun = async (rawArgs) => {
  const cwd = getWorkingDir();

  const passthroughFlags = rawArgs.filter((a) => a.startsWith('-') && !KNOWN_FLAGS.has(a));
  const knownArgs = rawArgs.filter((a) => !passthroughFlags.includes(a));

  const { values, positionals } = parseArgs({
    args: knownArgs,
    options: {
      new: { type: 'boolean', short: 'c' },
      detach: { type: 'boolean', short: 'd' },
      track: { type: 'boolean', short: 't' },
      'no-track': { type: 'boolean' },
      force: { type: 'boolean', short: 'f' },
      yes: { type: 'boolean', short: 'y' },
    },
    allowPositionals: true,
    strict: false,
  });

  const parsed = SwitchArgs.parse({
    newBranch: values.new,
    detach: values.detach,
    track: values.track,
    noTrack: values['no-track'],
    force: values.force,
    yes: values.yes,
    //? When -c is used: first positional is the new branch name, second is start point
    branch: values.new ? positionals[1] : positionals[0],
    newBranchName: values.new ? positionals[0] : undefined,
  });

  //? Naming a branch that already exists says exactly what you want, so the picker has nothing
  //? left to ask — the same reasoning as -c with a name, which can only mean "create this".
  //? An unmatched name still falls through to the TUI, where it seeds the search: that is the
  //? case where you were probably reaching for a branch whose full name you did not remember.
  const resolvesToExactBranch = async () => {
    if (!parsed.branch) return false;
    const { local, remote } = await getBranches(cwd);
    if (local.includes(parsed.branch)) return true;
    //? A single remote match is what plain `git switch` already creates a tracking branch from;
    //? two remotes carrying the same name is ambiguous, so leave that to the picker.
    return remote.filter((r) => r.slice(r.indexOf('/') + 1) === parsed.branch).length === 1;
  };

  const isUnambiguous =
    (parsed.newBranch && Boolean(parsed.newBranchName)) || (await resolvesToExactBranch());

  if (isUnambiguous || (parsed.yes && (parsed.newBranchName || parsed.branch))) {
    const args = ['switch'];
    if (parsed.newBranch && parsed.newBranchName) {
      args.push('-c', parsed.newBranchName);
      if (parsed.branch) args.push(parsed.branch);
    } else if (parsed.branch) {
      args.push(parsed.branch);
    }
    if (parsed.detach) args.push('--detach');
    if (parsed.track) args.push('--track');
    if (parsed.noTrack) args.push('--no-track');
    if (parsed.force) args.push('--force');
    args.push(...passthroughFlags);

    const result = await gitExec(args, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
    return;
  }

  const { default: renderInkSwitch } = await import('../ui/renderInkSwitch');
  await renderInkSwitch({
    initialBranch: parsed.branch,
    initialNewBranchName: parsed.newBranchName,
    initialFlags: {
      detach: parsed.detach,
      track: parsed.track,
      noTrack: parsed.noTrack,
      force: parsed.force,
    },
    passthroughFlags,
    cwd,
  });
};

export const meta = {
  name: 'switch',
  description:
    'Switch branches with interactive TUI — search local & remote branches, preview divergence',
};

export default run;

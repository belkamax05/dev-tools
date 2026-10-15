import { loadClearOptions, mergeClearOptions } from '../config/project';
import {
  applyIgnoredOptions,
  buildIgnoredTree,
  getIgnored,
  measureIgnored,
  printIgnoredTree,
} from '../core/ignored';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

/** Every `--name=value` (or `--name value`) in argv, so a flag can be given more than once. */
const flagValues = (args: string[], name: string) =>
  args.flatMap((arg, at) => {
    if (arg.startsWith(`--${name}=`)) return [arg.slice(name.length + 3)];
    const next = args[at + 1];
    return arg === `--${name}` && next !== undefined ? [next] : [];
  });

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const listOnly = args.includes('--list') || args.includes('-l');

  //? Ignored paths are reported against the top of the work tree, whichever folder giti ran in
  const top = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  if (top.exitCode !== 0) {
    console.error('❌ Not a git repository.');
    process.exit(1);
  }
  const root = top.stdout.trim();

  //? giti.config.ts first (nearest, plus GITI_CONFIG from a wrapping tool), flags on top
  const config = await loadClearOptions(root);
  for (const error of config.errors) console.error(`giti: ignoring ${error}`);
  const options = mergeClearOptions(config.options, {
    hide: flagValues(args, 'hide'),
    preselect: flagValues(args, 'select'),
  });

  //? Without a terminal there is nobody to tick anything, so the tree is printed instead —
  //? the same as --list, never a guess at what to delete
  if (listOnly || !process.stdin.isTTY || !process.stdout.isTTY) {
    const { entries, preselected } = applyIgnoredOptions(await getIgnored(root), options);
    if (!entries.length) {
      console.log('✨ git ignores nothing here — nothing to clear.');
      return;
    }
    const sizes = await measureIgnored(
      root,
      entries.map((e) => e.path),
    );
    console.log(`Ignored in ${root}:`);
    const tree = buildIgnoredTree(entries, sizes);
    for (const line of printIgnoredTree(tree, new Set(preselected))) console.log(line);
    return;
  }

  const { default: renderInkClear } = await import('../ui/renderInkClear');
  await renderInkClear(root, options);
};

export const meta = {
  name: 'clear',
  description:
    'Browse git-ignored files (caches, logs, build output, dependencies) as a tree; Space ticks, Enter deletes the ticked ones (--list to just print it; --select=<glob> / --hide=<glob> on top of giti.config.ts)',
};

export default run;

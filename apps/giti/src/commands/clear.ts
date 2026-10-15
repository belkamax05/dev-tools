import {
  buildIgnoredTree,
  getIgnored,
  measureIgnored,
  printIgnoredTree,
} from '../core/ignored';
import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

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

  //? Without a terminal there is nobody to tick anything, so the tree is printed instead —
  //? the same as --list, never a guess at what to delete
  if (listOnly || !process.stdin.isTTY || !process.stdout.isTTY) {
    const entries = await getIgnored(root);
    if (!entries.length) {
      console.log('✨ git ignores nothing here — nothing to clear.');
      return;
    }
    const sizes = await measureIgnored(
      root,
      entries.map((e) => e.path),
    );
    console.log(`Ignored in ${root}:`);
    for (const line of printIgnoredTree(buildIgnoredTree(entries, sizes))) console.log(line);
    return;
  }

  const { default: renderInkClear } = await import('../ui/renderInkClear');
  await renderInkClear(root);
};

export const meta = {
  name: 'clear',
  description:
    'Browse git-ignored files (caches, logs, build output, dependencies) as a tree; Space ticks, Enter deletes the ticked ones (--list to just print it)',
};

export default run;

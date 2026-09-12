import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaClean } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaClean(tree, cwd, args);
};

export const meta = {
  name: 'mega/clean',
  description:
    'Collect the branches, worktrees, refs and cloned history all three mechanisms abandon in .git (--dry-run to preview)',
};

export default run;

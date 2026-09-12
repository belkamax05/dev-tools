import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaCommit } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaCommit(tree, cwd, args);
};

export const meta = {
  name: 'mega/commit',
  description:
    'Commit uncommitted changes across every submodule, subrepo and subtree, and then this repository (--no-self, -m <msg>)',
};

export default run;

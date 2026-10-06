import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaPush } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaPush(tree, cwd, args);
};

export const meta = {
  name: 'mega/push',
  description:
    'Push every subrepo, submodule and subtree upstream and then this repository, refusing the pushes that would fail (--no-self)',
};

export default run;

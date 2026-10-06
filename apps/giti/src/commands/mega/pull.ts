import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaPull } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaPull(tree, cwd, args);
};

export const meta = {
  name: 'mega/pull',
  description:
    'Bring this repository and every subrepo, submodule and subtree up to date, skipping the ones already current (--no-self)',
};

export default run;

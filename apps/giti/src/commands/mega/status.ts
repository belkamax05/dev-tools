import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaStatus } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaStatus(tree, cwd, args);
};

export const meta = {
  name: 'mega/status',
  description:
    'Show this repository and every subrepo, submodule and subtree against their real upstreams (--no-fetch, --no-self)',
};

export default run;

import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaList } from '../../utils/megaCommands';

const run: CommandRun = async () => {
  const tree = await getMegaTree(getWorkingDir());
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  runMegaList(tree);
};

export const meta = {
  name: 'mega/list',
  description:
    'List this repository and everything vendored into it — subrepos, submodules and subtrees, grouped, offline',
};

export default run;

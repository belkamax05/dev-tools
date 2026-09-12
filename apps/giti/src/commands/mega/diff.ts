import type { CommandRun } from '../../types/CommandRun';
import getMegaTree from '../../utils/getMegaTree';
import getWorkingDir from '../../utils/getWorkingDir';
import { runMegaDiff } from '../../utils/megaCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  const tree = await getMegaTree(cwd);
  if (!tree) {
    console.error('❌ Not a git repository.');
    return;
  }

  await runMegaDiff(tree, cwd, args);
};

export const meta = {
  name: 'mega/diff',
  description:
    'Show what this repository and every vendored copy have that their upstreams do not (--stat, --no-self)',
};

export default run;

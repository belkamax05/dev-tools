import type { CommandRun } from '../../types/CommandRun';
import getSubtrees from '../../utils/getSubtrees';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPush } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPush(await getSubtrees(cwd), 'subtree', cwd, args);
};

export const meta = {
  name: 'subtree/push',
  description: 'Push a subtree’s prefix upstream, refusing up front on dirty, unchanged or behind',
};

export default run;

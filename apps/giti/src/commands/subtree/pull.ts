import type { CommandRun } from '../../types/CommandRun';
import getSubtrees from '../../utils/getSubtrees';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPull } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPull(await getSubtrees(cwd), 'subtree', cwd, args);
};

export const meta = {
  name: 'subtree/pull',
  description:
    'Merge each subtree’s upstream in, skipping the ones already current (--remote=/--branch= when git subtree did not record one)',
};

export default run;

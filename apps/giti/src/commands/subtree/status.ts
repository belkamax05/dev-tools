import type { CommandRun } from '../../types/CommandRun';
import getSubtrees from '../../utils/getSubtrees';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredStatus } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredStatus(await getSubtrees(cwd), 'subtree', cwd, args);
};

export const meta = {
  name: 'subtree/status',
  description:
    'Show each subtree against its real upstream — fetches first, so "behind" is a fact not a stale ref',
};

export default run;

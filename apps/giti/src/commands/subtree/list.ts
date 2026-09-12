import type { CommandRun } from '../../types/CommandRun';
import getSubtrees from '../../utils/getSubtrees';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredList } from '../../utils/vendoredCommands';

const run: CommandRun = async () => {
  runVendoredList(await getSubtrees(getWorkingDir()), 'subtree');
};

export const meta = {
  name: 'subtree/list',
  description: 'List the git subtree directories of this repository — offline, one line each',
};

export default run;

import type { CommandRun } from '../../types/CommandRun';
import getSubmodules from '../../utils/getSubmodules';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredList } from '../../utils/vendoredCommands';

const run: CommandRun = async () => {
  runVendoredList(await getSubmodules(getWorkingDir()), 'submodule');
};

export const meta = {
  name: 'submodule/list',
  description: 'List the git submodules of this repository — offline, one line each',
};

export default run;

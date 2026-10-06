import type { CommandRun } from '../../types/CommandRun';
import getSubmodules from '../../utils/getSubmodules';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredStatus } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredStatus(await getSubmodules(cwd), 'submodule', cwd, args);
};

export const meta = {
  name: 'submodule/status',
  description:
    'Show each submodule against its real upstream — fetches first, so "behind" is a fact not a stale ref',
};

export default run;

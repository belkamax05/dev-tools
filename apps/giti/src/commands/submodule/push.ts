import type { CommandRun } from '../../types/CommandRun';
import getSubmodules from '../../utils/getSubmodules';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPush } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPush(await getSubmodules(cwd), 'submodule', cwd, args);
};

export const meta = {
  name: 'submodule/push',
  description:
    'Push a submodule’s own commits upstream, refusing up front on dirty, unchanged or behind',
};

export default run;

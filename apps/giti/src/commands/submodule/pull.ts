import type { CommandRun } from '../../types/CommandRun';
import getSubmodules from '../../utils/getSubmodules';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPull } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPull(await getSubmodules(cwd), 'submodule', cwd, args);
};

export const meta = {
  name: 'submodule/pull',
  description:
    'Update every submodule (or the named ones) that actually moved upstream, skipping the current',
};

export default run;

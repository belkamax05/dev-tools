import type { CommandRun } from '../../types/CommandRun';
import getSubmodules from '../../utils/getSubmodules';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredDiff } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredDiff(await getSubmodules(cwd), 'submodule', cwd, args);
};

export const meta = {
  name: 'submodule/diff',
  description:
    'Show what the vendored copy of a submodule has that its pinned upstream commit does not',
};

export default run;

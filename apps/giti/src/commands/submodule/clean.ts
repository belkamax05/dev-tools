import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredClean } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  await runVendoredClean('submodule', getWorkingDir(), args);
};

export const meta = {
  name: 'submodule/clean',
  description:
    'Remove cloned history left in .git/modules by submodules that are no longer declared (--dry-run to preview)',
};

export default run;

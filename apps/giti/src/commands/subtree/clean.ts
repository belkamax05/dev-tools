import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredClean } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  await runVendoredClean('subtree', getWorkingDir(), args);
};

export const meta = {
  name: 'subtree/clean',
  description:
    'Remove the per-subtree fetch refs giti’s own status checks leave behind (--dry-run to preview)',
};

export default run;

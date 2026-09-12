import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredClean } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  await runVendoredClean('subrepo', getWorkingDir(), args);
};

export const meta = {
  name: 'subrepo/clean',
  description:
    'Remove the branches, worktrees, refs and .git/tmp files git-subrepo leaves behind after a run (--dry-run to preview)',
};

export default run;

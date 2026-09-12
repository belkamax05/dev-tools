import type { CommandRun } from '../../types/CommandRun';
import getSubrepos from '../../utils/getSubrepos';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredDiff } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredDiff(await getSubrepos(cwd), 'subrepo', cwd, args);
};

export const meta = {
  name: 'subrepo/diff',
  description:
    'Show what the vendored copy of a subrepo has that its pinned upstream commit does not',
};

export default run;

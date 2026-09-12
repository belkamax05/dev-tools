import type { CommandRun } from '../../types/CommandRun';
import getSubrepos from '../../utils/getSubrepos';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredStatus } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredStatus(await getSubrepos(cwd), 'subrepo', cwd, args);
};

export const meta = {
  name: 'subrepo/status',
  description:
    'Show each subrepo against its real upstream — fetches first, so "behind" is a fact not a stale ref',
};

export default run;

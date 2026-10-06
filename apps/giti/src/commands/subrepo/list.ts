import type { CommandRun } from '../../types/CommandRun';
import getSubrepos from '../../utils/getSubrepos';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredList } from '../../utils/vendoredCommands';

const run: CommandRun = async () => {
  runVendoredList(await getSubrepos(getWorkingDir()), 'subrepo');
};

export const meta = {
  name: 'subrepo/list',
  description: 'List the subrepos vendored into this repository — offline, one line each',
};

export default run;

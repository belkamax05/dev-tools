import type { CommandRun } from '../../types/CommandRun';
import getSubrepos from '../../utils/getSubrepos';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPull } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPull(await getSubrepos(cwd), 'subrepo', cwd, args);
};

export const meta = {
  name: 'subrepo/pull',
  description:
    'Pull every subrepo (or the named ones) that actually moved upstream, skipping the ones already current',
};

export default run;

import type { CommandRun } from '../../types/CommandRun';
import getSubrepos from '../../utils/getSubrepos';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredPush } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredPush(await getSubrepos(cwd), 'subrepo', cwd, args);
};

export const meta = {
  name: 'subrepo/push',
  description:
    'Push a subrepo upstream, refusing up front on the three things that make git-subrepo fail half-way',
};

export default run;

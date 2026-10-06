import type { CommandRun } from '../../types/CommandRun';
import getSubtrees from '../../utils/getSubtrees';
import getWorkingDir from '../../utils/getWorkingDir';
import { runVendoredDiff } from '../../utils/vendoredCommands';

const run: CommandRun = async (args) => {
  const cwd = getWorkingDir();
  await runVendoredDiff(await getSubtrees(cwd), 'subtree', cwd, args);
};

export const meta = {
  name: 'subtree/diff',
  description:
    'Show what the vendored copy of a subtree has that its pinned upstream commit does not',
};

export default run;

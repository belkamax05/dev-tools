import type { CommandRun } from '../../types/CommandRun';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';

const run: CommandRun = async () => {
  try {
    const { current, others } = await getOtherLocalBranches(getWorkingDir());

    console.log(`* ${current} (current)`);
    for (const branch of others) {
      console.log(`  ${branch}`);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-list',
  description: 'List all local branches, showing the current branch first',
};

export default run;

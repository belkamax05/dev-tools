import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getCurrentCommit from '../../utils/getCurrentCommit';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();
    const { current, others } = await getOtherLocalBranches(rootDir);

    console.log(`Git directory: ${formatArg(rootDir)}`);

    if (!current || current === 'HEAD') {
      const hash = await getCurrentCommit(rootDir, { short: false });
      console.log(`(not in branch) Hash is ${formatArg(hash)}`);
    } else {
      console.log(`Current branch: ${formatArg(current)}`);
    }

    console.log('Local branches:');
    if (others.length > 0) {
      for (const branch of others) {
        console.log(`  - ${branch}`);
      }
    } else {
      console.log('  (none)');
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-status',
  description: 'Show the current branch and all local branches in the repo',
};

export default run;

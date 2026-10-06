import type { CommandRun } from '../types/CommandRun';
import getCurrentCommit from '../utils/getCurrentCommit';
import getWorkingDir from '../utils/getWorkingDir';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();
    const hash = await getCurrentCommit(rootDir, { short: false });
    console.log(`${hash} - current (HEAD)`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'hash',
  description: 'Print the full commit hash of HEAD',
};

export default run;

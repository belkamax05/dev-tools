import type { CommandRun } from '../types/CommandRun';
import getBehindAhead from '../utils/getBehindAhead';
import getBranch from '../utils/getBranch';
import getBranches from '../utils/getBranches';
import getWorkingDir from '../utils/getWorkingDir';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();
    const { local } = await getBranches(rootDir);
    const current = await getBranch(rootDir);

    console.log('🌳 Local Branches:');

    for (const branch of local) {
      const isCurrent = branch === current;
      const prefix = isCurrent ? '* ' : '  ';
      let info = '';

      // Check upstream status
      // We assume upstream is origin/branch for simplicity, or we could parse separate tracking info
      // getBehindAhead defaults to comparing against whatever we pass.
      // Ideally we'd know the tracking branch.
      // For now, let's try comparing against origin/main or origin/master just to see divergence?
      // Or just try origin/<branch>

      try {
        const { ahead, behind } = await getBehindAhead(rootDir, `origin/${branch}`, branch);
        if (ahead > 0 || behind > 0) {
          info = ` (ahead ${ahead}, behind ${behind})`;
        } else {
          info = ' (synced)';
        }
      } catch {
        info = ' (no upstream)';
      }

      console.log(`${prefix}${branch}${info}`);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branches',
  description: 'List all local branches with their ahead/behind status relative to origin',
};

export default run;

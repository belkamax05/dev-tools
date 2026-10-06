import type { CommandRun } from '../types/CommandRun';
import cancelAllChanges from '../utils/cancelAllChanges';
import getWorkingDir from '../utils/getWorkingDir';

const run: CommandRun = async () => {
  try {
    const cwd = getWorkingDir();

    console.log('🔄 Reverting to HEAD (*.patch files are preserved)...');
    const counts = await cancelAllChanges(cwd);
    const total = counts.newlyAdded + counts.staged + counts.modified + counts.untracked;

    if (total === 0) {
      console.log('ℹ️  Nothing to cancel — working tree is clean.');
      return;
    }

    if (counts.staged > 0) console.log(`   staged:    ${counts.staged} file(s)`);
    if (counts.newlyAdded > 0) console.log(`   new:       ${counts.newlyAdded} file(s) deleted`);
    if (counts.modified > 0) console.log(`   modified:  ${counts.modified} file(s)`);
    if (counts.untracked > 0) console.log(`   untracked: ${counts.untracked} file(s) deleted`);

    console.log('✅ All changes reverted.');
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'cancel-all',
  description:
    'Revert all tracked changes to HEAD — newly-added staged files are deleted, untracked files are left as-is, *.patch files are preserved.',
};

export default run;

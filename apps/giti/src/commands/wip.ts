import type { CommandRun } from '../types/CommandRun';
import commit from '../utils/commit';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import stageAll from '../utils/stageAll';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();

    //? Staging everything from a clean tree leaves git with nothing to commit, and git reports
    //? that on stdout — so the failure branch below would print a bare "Commit failed:" with an
    //? empty reason. The answer is already known here, so say it plainly instead.
    if (!(await getStatus(rootDir)).trim()) {
      console.log('ℹ️  Nothing to commit — working tree is clean.');
      return;
    }

    console.log('📦 Staging all files...');
    await stageAll(rootDir);

    console.log('💾 Committing WIP...');
    const result = await commit(rootDir, 'wip', { noVerify: true });

    if (result.exitCode === 0) {
      console.log('✅ WIP commit created.');
      console.log(result.stdout);
    } else {
      console.error('❌ Commit failed:', result.stderr || result.stdout);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'wip',
  description: 'Stage all changes and create a "wip" commit, bypassing hooks',
};

export default run;

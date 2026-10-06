import type { CommandRun } from '../types/CommandRun';
import commit from '../utils/commit';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import stageAll from '../utils/stageAll';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();

    //? With nothing to fold in, `--amend --no-edit` still succeeds and rewrites the commit —
    //? same tree, new hash — which is pure downside once that commit has been pushed. Amending
    //? is only meaningful when there is a change to absorb.
    if (!(await getStatus(rootDir)).trim()) {
      console.log('ℹ️  Nothing to amend — working tree is clean.');
      return;
    }

    console.log('📦 Staging all files...');
    await stageAll(rootDir);

    console.log('📝 Amending last commit...');
    const result = await commit(rootDir, undefined, { amend: true, noEdit: true });

    if (result.exitCode === 0) {
      console.log('✅ Commit amended.');
      console.log(result.stdout);
    } else {
      console.error('❌ Amend failed:', result.stderr || result.stdout);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'amend',
  description: 'Stage all changes and fold them into the last commit without editing the message',
};

export default run;

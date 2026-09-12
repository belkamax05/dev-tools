import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import resetSoft from '../utils/resetSoft';

const run: CommandRun = async () => {
  try {
    console.log('⏮️  Undoing last commit (soft reset)...');
    const result = await resetSoft(getWorkingDir());

    if (result.exitCode === 0) {
      console.log('✅ Last commit undone. Changes are staged.');
    } else {
      console.error('❌ Undo failed:', result.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'undo',
  description: 'Soft-reset HEAD by one commit, leaving all changes staged',
};

export default run;

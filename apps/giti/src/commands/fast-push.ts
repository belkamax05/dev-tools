import type { CommandRun } from '../types/CommandRun';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';

const run: CommandRun = async () => {
  try {
    const rootDir = getWorkingDir();
    console.log('🚀 Fast pushing to origin...');
    const result = await gitExec(['push', '--no-verify', '-u', 'origin', 'HEAD'], rootDir);

    if (result.exitCode === 0) {
      console.log('✅ Pushed successfully.');
      if (result.stdout) console.log(result.stdout);
      if (result.stderr && !result.stderr.toLowerCase().includes('error')) {
        // git push often outputs progress to stderr, print it if it's not an error log
        console.log(result.stderr);
      }
    } else {
      console.error('❌ Push failed:', result.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'fast-push',
  description: 'Push to origin without verification (--no-verify -u origin)',
};

export default run;

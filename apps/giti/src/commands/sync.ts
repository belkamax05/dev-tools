import type { CommandRun } from '../types/CommandRun';
import fetch from '../utils/fetch';
import getWorkingDir from '../utils/getWorkingDir';
import pull from '../utils/pull';

const run: CommandRun = async () => {
  const rootDir = getWorkingDir();
  console.log('🔄 Fetching from all remotes...');
  const fetchResult = await fetch(rootDir);
  if (fetchResult.exitCode !== 0) {
    console.error('❌ Fetch failed:', fetchResult.stderr);
    return;
  }
  console.log('✅ Fetched.');

  console.log('⬇️  Pulling changes...');
  const pullResult = await pull(rootDir);
  if (pullResult.exitCode !== 0) {
    console.error('❌ Pull failed:', pullResult.stderr);
    return;
  }
  console.log('✅ Pulled.');
  console.log(pullResult.stdout);
};

export const meta = {
  name: 'sync',
  description: 'Fetch from all remotes and pull the latest changes into the current branch',
};

export default run;

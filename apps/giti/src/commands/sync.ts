import type { CommandRun } from '../types/CommandRun';
import fetch from '../utils/fetch';
import getWorkingDir from '../utils/getWorkingDir';
import runTransferCommand from '../utils/runTransferCommand';

const run: CommandRun = async (args) => {
  const rootDir = getWorkingDir();
  console.log('🔄 Fetching from all remotes...');
  const fetchResult = await fetch(rootDir);
  if (fetchResult.exitCode !== 0) {
    console.error('❌ Fetch failed:', fetchResult.stderr);
    return;
  }
  console.log('✅ Fetched.');

  //? Then the whole tree's pull, without its screen: sync is the no-questions path
  await runTransferCommand('receive', ['--yes', ...args]);
};

export const meta = {
  name: 'sync',
  description:
    'Fetch from all remotes, then receive — pull this repository and everything vendored in it',
};

export default run;

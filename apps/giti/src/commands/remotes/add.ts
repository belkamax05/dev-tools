import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import addRemote from '../../utils/addRemote';
import getWorkingDir from '../../utils/getWorkingDir';

const run: CommandRun = async ([name, url]) => {
  if (!name || !url) {
    console.error('Usage: giti remotes add <name> <url>');
    process.exitCode = 1;
    return;
  }

  const result = await addRemote(getWorkingDir(), name, url);
  if (result.exitCode !== 0) {
    console.error(`❌ Failed to add ${formatArg(name)}:`, result.stderr);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Added remote ${formatArg(name)} → ${url}`);
};

export const meta = {
  name: 'remotes/add',
  description: 'Add a remote: giti remotes add <name> <url>',
};

export default run;

import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import renameRemote from '../../utils/renameRemote';

const run: CommandRun = async ([oldName, newName]) => {
  if (!oldName || !newName) {
    console.error('Usage: giti remote rename <old> <new>');
    process.exitCode = 1;
    return;
  }

  //? `git remote rename` also rewrites the remote-tracking refs and every branch's
  //? `branch.<name>.remote`, so tracking survives the rename
  const result = await renameRemote(getWorkingDir(), oldName, newName);
  if (result.exitCode !== 0) {
    console.error(`❌ Failed to rename ${formatArg(oldName)}:`, result.stderr);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Renamed remote ${formatArg(oldName)} → ${formatArg(newName)}`);
};

export const meta = {
  name: 'remote/rename',
  description: 'Rename a remote, keeping its tracking branches: giti remote rename <old> <new>',
};

export default run;

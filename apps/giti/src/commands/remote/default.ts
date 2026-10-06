import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getDefaultPushRemote from '../../utils/getDefaultPushRemote';
import getRemotes from '../../utils/getRemotes';
import getWorkingDir from '../../utils/getWorkingDir';
import setDefaultPushRemote from '../../utils/setDefaultPushRemote';

const run: CommandRun = async ([name]) => {
  const cwd = getWorkingDir();

  if (!name) {
    const current = await getDefaultPushRemote(cwd);
    console.log(
      current
        ? `📡 Default push remote: ${formatArg(current)}`
        : 'ℹ️  No default push remote — pushes go to each branch’s own remote.',
    );
    return;
  }

  //? `git config` would happily store a name that is not a remote, and every later push would
  //? then fail far from the cause
  const remotes = await getRemotes(cwd);
  if (!remotes.includes(name)) {
    console.error(`❌ ${formatArg(name)} is not a remote. Known: ${remotes.join(', ') || 'none'}`);
    process.exitCode = 1;
    return;
  }

  const result = await setDefaultPushRemote(cwd, name);
  if (result.exitCode !== 0) {
    console.error('❌ Failed to set the default push remote:', result.stderr);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ Default push remote is now ${formatArg(name)}`);
};

export const meta = {
  name: 'remote/default',
  description:
    'Show the default push remote (remote.pushDefault), or set it: giti remote default <name>',
};

export default run;

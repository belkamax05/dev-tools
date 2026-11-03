import formatArg from '@/dev-tools/utils/format/formatArg';
import { getRemoteStashes, getTopLevel, resolveStashRemote } from '../../core/remoteStash';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';

const run: CommandRun = async (args) => {
  try {
    const parsed = parseStashArgs(args);
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root, parsed.remote);
    const stashes = await getRemoteStashes(root, remote);

    if (stashes.length === 0) {
      console.log(`ℹ️  No stashes on ${formatArg(remote)}. Share one with giti stash save <name>.`);
      return;
    }

    const width = Math.max(...stashes.map((stash) => stash.name.length));
    for (const stash of stashes) {
      const on = stash.branch ? ` · on ${stash.branch}` : '';
      console.log(`📦 ${formatArg(stash.name.padEnd(width))}  ${stash.author} · ${stash.when}${on}`);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export const meta = {
  name: 'stash/list',
  description:
    'List the stashes shared on the remote (refs/stashes/*), most recent first, with author, age and branch',
};

export default run;

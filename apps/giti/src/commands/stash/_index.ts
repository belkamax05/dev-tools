import { getTopLevel, resolveStashRemote } from '../../core/remoteStash';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import list from './list';

/**
 * Bare `giti stash`: the remote stashes dashboard — list, preview, apply, remove, save new.
 * Off a terminal there is nothing to click, so it prints the listing `giti stash list` does.
 */
const run: CommandRun = async (args) => {
  if (!process.stdin.isTTY) return list(args);
  try {
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root);
    const { default: renderInkStashDashboard } = await import('../../ui/renderInkStashDashboard');
    await renderInkStashDashboard({ cwd: root, remote });
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export default run;

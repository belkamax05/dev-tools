import formatArg from '@/dev-tools/utils/format/formatArg';
import {
  applyRemoteStash,
  getRemoteStashes,
  getRemoteStashFiles,
  getTopLevel,
  resolveStashRemote,
} from '../../core/remoteStash';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';

const run: CommandRun = async (args) => {
  try {
    const parsed = parseStashArgs(args);
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root, parsed.remote);

    let name = parsed.name;
    let index = !parsed.unstaged;
    if (process.stdin.isTTY && !parsed.yes) {
      const { default: renderInkRemoteStashes } = await import('../../ui/renderInkRemoteStashes');
      const choice = await renderInkRemoteStashes({
        cwd: root,
        remote,
        mode: 'apply',
        initialName: name,
        initialIndex: index,
      });
      if (!choice) {
        console.log('Cancelled — nothing applied.');
        return;
      }
      name = choice.stash.name;
      index = choice.index;
    } else {
      if (!name) {
        console.error('Usage: giti stash apply <name> [--remote=<name>] [--unstaged] [--yes]');
        process.exitCode = 1;
        return;
      }
      const stash = (await getRemoteStashes(root, remote)).find((entry) => entry.name === name);
      if (stash) {
        console.log(`📦 ${formatArg(name)} — ${stash.author} · ${stash.when}`);
        for (const file of await getRemoteStashFiles(root, stash.hash))
          console.log(`   ${file.status.padEnd(2)} ${file.path}`);
      }
    }

    const result = await applyRemoteStash(root, remote, name, { index });
    if (!result.ok) {
      console.error(`❌ ${result.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ ${result.message}`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export const meta = {
  name: 'stash/apply',
  description:
    'Apply a stash shared on the remote, previewing its files and diff first; staged changes come back staged (--unstaged applies them all unstaged); the stash stays on the remote',
};

export default run;

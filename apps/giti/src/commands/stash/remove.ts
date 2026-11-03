import { confirm, isCancel } from '@clack/prompts';
import formatArg from '@/dev-tools/utils/format/formatArg';
import { getTopLevel, removeRemoteStash, resolveStashRemote } from '../../core/remoteStash';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';

const run: CommandRun = async (args) => {
  try {
    const parsed = parseStashArgs(args);
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root, parsed.remote);

    let name = parsed.name;
    if (!name) {
      if (!process.stdin.isTTY) {
        console.error('Usage: giti stash remove <name> [--remote=<name>] [--yes]');
        process.exitCode = 1;
        return;
      }
      //? The picker asks before it closes, so a name picked there is already confirmed
      const { default: renderInkRemoteStashes } = await import('../../ui/renderInkRemoteStashes');
      const choice = await renderInkRemoteStashes({ cwd: root, remote, mode: 'remove' });
      if (!choice) {
        console.log('Cancelled — nothing removed.');
        return;
      }
      name = choice.stash.name;
    } else if (!parsed.yes) {
      //? Shared: removing it removes it for the whole team, so a typed name is asked about too
      if (!process.stdin.isTTY) {
        console.log('ℹ️  Not an interactive terminal — re-run with --yes to remove it.');
        return;
      }
      const proceed = await confirm({ message: `Remove stash ${name} from ${remote} for everyone?` });
      if (isCancel(proceed) || !proceed) {
        console.log('Cancelled — nothing removed.');
        return;
      }
    }

    const result = await removeRemoteStash(root, remote, name);
    if (!result.ok) {
      console.error(`❌ ${result.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ Removed stash ${formatArg(name)} from ${formatArg(remote)}`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export const meta = {
  name: 'stash/remove',
  description:
    'Delete a stash shared on the remote, for everyone; picks one with a preview when no name is given (--yes skips the question)',
};

export default run;

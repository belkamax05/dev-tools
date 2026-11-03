import formatArg from '@/dev-tools/utils/format/formatArg';
import { getTopLevel, resolveStashRemote, saveRemoteStash } from '../../core/remoteStash';
import { getChanges } from '../../core/status';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';

const run: CommandRun = async (args) => {
  try {
    const parsed = parseStashArgs(args);
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root, parsed.remote);

    const changes = await getChanges(root);
    if (changes.length === 0) {
      console.log('ℹ️  Nothing to stash — working tree is clean.');
      return;
    }

    let { name, force } = parsed;
    //? The preview is the interactive path, as with `giti save`: --yes, or no terminal, skips it
    if (process.stdin.isTTY && !parsed.yes) {
      const { default: renderInkStashSave } = await import('../../ui/renderInkStashSave');
      const choice = await renderInkStashSave({
        cwd: root,
        remote,
        initialName: name,
        initialForce: force,
      });
      if (!choice) {
        console.log('Cancelled — nothing saved.');
        return;
      }
      ({ name, force } = choice);
    } else {
      if (!name) {
        console.error('Usage: giti stash save <name> [--remote=<name>] [--force] [--yes]');
        process.exitCode = 1;
        return;
      }
      for (const change of changes) {
        const state = change.untracked ? '??' : `${change.index}${change.work}`;
        console.log(`   ${state.replaceAll(' ', '.')} ${change.path}`);
      }
    }

    console.log(`🔄 Pushing stash ${formatArg(name)} to ${formatArg(remote)}…`);
    const result = await saveRemoteStash(root, remote, name, { force });
    if (!result.ok) {
      console.error(`❌ ${result.message}`);
      process.exitCode = 1;
      return;
    }
    console.log(`✅ ${result.message}. Teammates: giti stash apply ${name}`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
    process.exitCode = 1;
  }
};

export const meta = {
  name: 'stash/save',
  description:
    'Share your uncommitted changes (staged, unstaged and untracked) as a named stash on the remote; previews the files first, leaves the work tree as it is (--force replaces, --yes skips the preview)',
};

export default run;

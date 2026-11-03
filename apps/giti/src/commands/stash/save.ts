import formatArg from '@/dev-tools/utils/format/formatArg';
import {
  getTopLevel,
  matchChangedPaths,
  resolveStashRemote,
  saveRemoteStash,
} from '../../core/remoteStash';
import { getChanges } from '../../core/status';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';
import resolveRepoPaths from '../../utils/resolveRepoPaths';

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

    //? Typed relative to the folder the command ran in; status prints them from the top
    let paths: string[] | undefined;
    if (parsed.paths) {
      const typed = (await resolveRepoPaths(getWorkingDir(), parsed.paths)).paths;
      paths = matchChangedPaths(changes, typed).map((change) => change.path);
      if (!paths.length) {
        console.error(`❌ None of ${parsed.paths.join(', ')} has changes to stash.`);
        process.exitCode = 1;
        return;
      }
    }

    let { name, force } = parsed;
    //? The checklist is the interactive path: --yes, or no terminal, stashes what was typed
    if (process.stdin.isTTY && !parsed.yes) {
      const { default: renderInkStashSave } = await import('../../ui/renderInkStashSave');
      const choice = await renderInkStashSave({
        cwd: root,
        remote,
        initialName: name,
        initialForce: force,
        initialPaths: paths,
      });
      if (!choice) {
        console.log('Cancelled — nothing saved.');
        return;
      }
      ({ name, force, paths } = choice);
    } else {
      if (!name) {
        console.error(
          'Usage: giti stash save <name> [--remote=<name>] [--force] [--yes] [-- <paths>…]',
        );
        process.exitCode = 1;
        return;
      }
      const chosen = paths ? new Set(paths) : undefined;
      for (const change of changes) {
        if (chosen && !chosen.has(change.path)) continue;
        const state = change.untracked ? '??' : `${change.index}${change.work}`;
        console.log(`   ${state.replaceAll(' ', '.')} ${change.path}`);
      }
    }

    console.log(`🔄 Pushing stash ${formatArg(name)} to ${formatArg(remote)}…`);
    const result = await saveRemoteStash(root, remote, name, { force, paths });
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
    'Share chosen uncommitted files (staged, unstaged, untracked) as a named stash on the remote: tick files with their diffs, or name them after --; work tree and index are not touched (--force replaces, --yes skips the checklist)',
};

export default run;

import formatArg from '@/dev-tools/utils/format/formatArg';
import {
  applyRemoteStash,
  getRemoteStashes,
  getRemoteStashFiles,
  getTopLevel,
  matchChangedPaths,
  resolveStashRemote,
} from '../../core/remoteStash';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import parseStashArgs from '../../utils/parseStashArgs';
import resolveRepoPaths from '../../utils/resolveRepoPaths';

const run: CommandRun = async (args) => {
  try {
    const parsed = parseStashArgs(args);
    const root = await getTopLevel(getWorkingDir());
    const remote = await resolveStashRemote(root, parsed.remote);

    let name = parsed.name;
    let index = !parsed.unstaged;
    //? Typed relative to the folder the command ran in; a stash names its files from the top
    const typed = parsed.paths
      ? (await resolveRepoPaths(getWorkingDir(), parsed.paths)).paths
      : undefined;
    if (typed && !name) {
      console.error('Name the stash to take files from: giti stash apply <name> -- <paths>…');
      process.exitCode = 1;
      return;
    }

    let paths: string[] | undefined;
    const stash = name
      ? (await getRemoteStashes(root, remote)).find((entry) => entry.name === name)
      : undefined;
    if (name && !stash) {
      console.error(`❌ ${remote} has no stash named ${name} — giti stash list shows them`);
      process.exitCode = 1;
      return;
    }
    const files = stash ? await getRemoteStashFiles(root, stash.hash) : [];
    if (typed) {
      paths = matchChangedPaths(files, typed).map((file) => file.path);
      if (!paths.length) {
        console.error(`❌ None of ${parsed.paths?.join(', ')} is in stash ${name}.`);
        process.exitCode = 1;
        return;
      }
    }

    if (process.stdin.isTTY && !parsed.yes) {
      const { default: renderInkRemoteStashes } = await import('../../ui/renderInkRemoteStashes');
      const choice = await renderInkRemoteStashes({
        cwd: root,
        remote,
        mode: 'apply',
        initialName: name,
        initialIndex: index,
        initialPaths: paths,
      });
      if (!choice) {
        console.log('Cancelled — nothing applied.');
        return;
      }
      name = choice.stash.name;
      index = choice.index;
      paths = choice.paths;
    } else {
      if (!name || !stash) {
        console.error(
          'Usage: giti stash apply <name> [--remote=<name>] [--unstaged] [--yes] [-- <paths>…]',
        );
        process.exitCode = 1;
        return;
      }
      const chosen = paths ? new Set(paths) : undefined;
      console.log(`📦 ${formatArg(name)} — ${stash.author} · ${stash.when}`);
      for (const file of files)
        if (!chosen || chosen.has(file.path)) console.log(`   ${file.status.padEnd(2)} ${file.path}`);
    }

    const result = await applyRemoteStash(root, remote, name, { index, paths });
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
    'Apply a stash shared on the remote, or only some of its files: pick them with their diffs, or name them after --; staged changes come back staged (--unstaged applies them all unstaged); the stash stays on the remote',
};

export default run;

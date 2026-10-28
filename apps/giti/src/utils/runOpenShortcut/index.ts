import formatArg from '@/dev-tools/utils/format/formatArg';
import open from '../../commands/open';
import getGitiCommand from '../getGitiCommand';
import type { RepoLinkTarget } from '../repoWebLinks';

/**
 * The body of a one-target `giti open` shortcut (`url`, `pages`): opens the page and names the
 * `print` form that only prints it, or with `print` prints the bare URL for a pipe.
 *
 * `open` already picks the remote and turns an SSH alias into the real site, for every host it
 * knows — this only adds the shortcut's own argument and hint.
 */
const runOpenShortcut = async (name: string, target: RepoLinkTarget, args: string[]) => {
  const [first, ...rest] = args;
  const command = getGitiCommand();

  if (first === 'print') return open([target, '--print', ...rest]);
  if (first !== undefined && !first.startsWith('-')) {
    console.error(
      `❌ Unknown argument ${formatArg(first)}.\n\nUsage: ${command} ${name} [print] [--remote=<name>]`,
    );
    process.exitCode = 1;
    return;
  }

  await open([target, ...args]);
  if (!process.exitCode) {
    console.log(`💡 ${formatArg(`${command} ${name} print`)} prints the URL without opening it`);
  }
};

export default runOpenShortcut;

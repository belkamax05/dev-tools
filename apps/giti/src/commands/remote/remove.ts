import { confirm, isCancel } from '@clack/prompts';
import { parseArgs } from 'node:util';
import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getRemotesDetail from '../../utils/getRemotesDetail';
import getWorkingDir from '../../utils/getWorkingDir';
import removeRemote from '../../utils/removeRemote';

const run: CommandRun = async (args) => {
  const { values, positionals } = parseArgs({
    args,
    options: { yes: { type: 'boolean', short: 'y', default: false } },
    allowPositionals: true,
    strict: false,
  });
  const [name] = positionals;
  if (!name) {
    console.error('Usage: giti remote remove <name> [--yes]');
    process.exitCode = 1;
    return;
  }

  const cwd = getWorkingDir();
  const remote = (await getRemotesDetail(cwd)).find((entry) => entry.name === name);
  if (!remote) {
    console.error(`❌ ${formatArg(name)} is not a remote.`);
    process.exitCode = 1;
    return;
  }

  //? Removing a remote also drops its remote-tracking branches and every branch's tracking
  //? setting for it — print the URL so it can be re-added, and ask first
  console.log(`📡 ${formatArg(name)} → ${remote.fetchUrl}`);
  if (values.yes !== true) {
    if (!process.stdin.isTTY) {
      console.log('ℹ️  Not an interactive terminal — re-run with --yes to remove it.');
      return;
    }
    const proceed = await confirm({ message: `Remove remote ${name}?` });
    if (isCancel(proceed) || !proceed) {
      console.log('Cancelled — nothing removed.');
      return;
    }
  }

  const result = await removeRemote(cwd, name);
  if (result.exitCode !== 0) {
    console.error(`❌ Failed to remove ${formatArg(name)}:`, result.stderr);
    process.exitCode = 1;
    return;
  }
  console.log(
    `✅ Removed remote ${formatArg(name)}. Re-add with: giti remote add ${name} ${remote.fetchUrl}`,
  );
};

export const meta = {
  name: 'remote/remove',
  description: 'Remove a remote after showing its URL and asking (--yes to skip the prompt)',
};

export default run;

import { parseArgs } from 'node:util';
import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getWorkingDir from '../../utils/getWorkingDir';
import setRemoteUrl from '../../utils/setRemoteUrl';

const run: CommandRun = async (args) => {
  const { values, positionals } = parseArgs({
    args,
    options: { push: { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: false,
  });
  const [name, url] = positionals;
  if (!name || !url) {
    console.error('Usage: giti remote set-url <name> <url> [--push]');
    process.exitCode = 1;
    return;
  }

  const push = values.push === true;
  const result = await setRemoteUrl(getWorkingDir(), name, url, push);
  if (result.exitCode !== 0) {
    console.error(`❌ Failed to set the URL of ${formatArg(name)}:`, result.stderr);
    process.exitCode = 1;
    return;
  }
  console.log(`✅ ${formatArg(name)} ${push ? 'pushes' : 'fetches'} from ${url}`);
};

export const meta = {
  name: 'remote/set-url',
  description:
    'Change a remote URL: giti remote set-url <name> <url>; --push sets a separate push URL',
};

export default run;

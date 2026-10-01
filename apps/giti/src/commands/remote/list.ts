import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../../types/CommandRun';
import getDefaultPushRemote from '../../utils/getDefaultPushRemote';
import getRemotesDetail from '../../utils/getRemotesDetail';
import getWorkingDir from '../../utils/getWorkingDir';
import repoWebLinks from '../../utils/repoWebLinks';

const run: CommandRun = async () => {
  try {
    const cwd = getWorkingDir();
    const [remotes, defaultPush] = await Promise.all([
      getRemotesDetail(cwd),
      getDefaultPushRemote(cwd),
    ]);

    if (remotes.length === 0) {
      console.log('ℹ️  No remotes. Add one with `giti remote add <name> <url>`.');
      return;
    }

    for (const { name, fetchUrl, pushUrl } of remotes) {
      const marker = name === defaultPush ? ' (default push)' : '';
      console.log(`📡 ${formatArg(name)}${marker}`);
      console.log(`   fetch  ${fetchUrl}`);
      //? Only worth a line when it differs — git reports the fetch URL for push when unset
      if (pushUrl && pushUrl !== fetchUrl) console.log(`   push   ${pushUrl}`);
      //? Same address `giti open` uses, so an SSH host alias prints as the real site
      const web = repoWebLinks(fetchUrl)?.home;
      if (web) console.log(`   web    ${web}`);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'remote/list',
  description: 'List remotes with their fetch, push and web URLs, marking the default push remote',
};

export default run;

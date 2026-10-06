#!/usr/bin/env bun
import formatColor from '@/dev-tools/utils/format/formatColor';
import brew from '@/dev-tools/utils/install/brew';
import ensureInstalled from '@/dev-tools/utils/install/ensureInstalled';
import isSubrepoUsable from '../../utils/isSubrepoUsable';

const run = async () => {
  const outcome = await ensureInstalled({
    installer: brew,
    packageName: 'git-subrepo',
    isInstalled: isSubrepoUsable,
  });

  console.log(
    outcome === 'installed'
      ? formatColor('git-subrepo installed', 'success')
      : formatColor('git-subrepo already installed', 'info'),
  );
};

if (import.meta.main) await run();

export const meta = {
  name: 'subrepo/install',
  description: 'Install git-subrepo if this machine does not already have it',
};

export default run;

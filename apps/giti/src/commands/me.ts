import formatArg from '@/dev-tools/utils/format/formatArg';
import type { CommandRun } from '../types/CommandRun';
import getBranch from '../utils/getBranch';
import getCurrentCommit from '../utils/getCurrentCommit';
import getCurrentUser from '../utils/getCurrentUser';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';

const run: CommandRun = async () => {
  const cwd = getWorkingDir();
  const [shortHash, longHash, statusPorcelain, user, currentBranch] = await Promise.all([
    getCurrentCommit(cwd, { short: true }),
    getCurrentCommit(cwd, { short: false }),
    getStatus(cwd),
    getCurrentUser(cwd),
    getBranch(cwd),
  ]);

  const printResult = {
    currentUser: user.name,
    currentEmail: user.email,
    currentFolder: cwd,
    currentBranch,
    shortHash,
    longHash,
    status: statusPorcelain ? 'Dirty' : 'Clean',
    statusDetails: statusPorcelain || 'Nothing to commit',
  };

  console.log(
    Object.keys(printResult)
      .map((key) => `${formatArg(key)}: ${(printResult as any)[key]}`)
      .join('\n'),
  );
};

export const meta = {
  name: 'me',
  description: 'Show a summary of the current repo state: branch, commit hashes, and dirty status',
};

export default run;

import type { CommandRun } from '../types/CommandRun';
import type { StatusData } from '../ui/renderInkStatus';
import getBranch from '../utils/getBranch';
import getRemotes from '../utils/getRemotes';
import getStashCount from '../utils/getStashCount';
import getStatus from '../utils/getStatus';
import getUpstreamBranch from '../utils/getUpstreamBranch';
import getUpstreamStats from '../utils/getUpstreamStats';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';
import parsePorcelainStatus from '../utils/parsePorcelainStatus';

const run: CommandRun = async () => {
  const cwd = getWorkingDir();

  const [branch, remotes, stats, upstream, porcelain, logResult, stashCount] = await Promise.all([
    getBranch(cwd).catch(() => 'HEAD'),
    getRemotes(cwd),
    getUpstreamStats(cwd),
    getUpstreamBranch(cwd),
    getStatus(cwd).catch(() => ''),
    gitExec(['log', '-8', '--format=%h|%an|%ar|%s'], cwd),
    getStashCount(cwd),
  ]);

  const remote = remotes[0] ?? '';
  const { staged, modified, untracked, conflicted } = parsePorcelainStatus(porcelain);

  const recentCommits =
    logResult.exitCode === 0
      ? logResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash = '', author = '', rel = '', ...rest] = line.split('|');
            return { hash, author, rel, subject: rest.join('|') };
          })
      : [];

  const data: StatusData = {
    branch,
    upstream,
    remote,
    ahead: stats.ahead,
    behind: stats.behind,
    staged,
    modified,
    untracked,
    conflicted,
    stashCount,
    recentCommits,
  };

  const { default: renderInkStatus } = await import('../ui/renderInkStatus');
  await renderInkStatus(data);
};

export const meta = {
  name: 'status',
  description:
    'Pretty-print repository status: branch, staged/modified/untracked files, stash, and recent commits',
};

export default run;

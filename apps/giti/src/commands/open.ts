import { parseArgs } from 'node:util';
import formatArg from '@/dev-tools/utils/format/formatArg';
import openUrl from '@/dev-tools/utils/system/openUrl';
import revealPath from '@/dev-tools/utils/system/revealPath';
import type { CommandRun } from '../types/CommandRun';
import getBranch from '../utils/getBranch';
import getRemotesDetail from '../utils/getRemotesDetail';
import getWorkingDir from '../utils/getWorkingDir';
import gitExec from '../utils/gitExec';
import repoWebLinks, { type RepoLinkTarget } from '../utils/repoWebLinks';

const ALIASES: Record<string, RepoLinkTarget | 'folder'> = {
  home: 'home',
  repo: 'home',
  actions: 'actions',
  ci: 'actions',
  pipelines: 'actions',
  pulls: 'pulls',
  prs: 'pulls',
  mrs: 'pulls',
  issues: 'issues',
  pages: 'pages',
  settings: 'settings',
  pr: 'pr',
  mr: 'pr',
  folder: 'folder',
  dir: 'folder',
};

const USAGE = `Usage: giti open [target] [--remote=<name>] [--base=<branch>] [--print]

Targets: home (default), actions|ci|pipelines, pulls|prs|mrs, issues, pages, settings,
         pr|mr (open a pull/merge request for the current branch), folder`;

const run: CommandRun = async (args) => {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        remote: { type: 'string' },
        base: { type: 'string' },
        print: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      strict: false,
    });
    if (values.help === true) {
      console.log(USAGE);
      return;
    }

    const [requested = 'home'] = positionals;
    const target = ALIASES[requested];
    if (!target) {
      console.error(`❌ Unknown target ${formatArg(requested)}.\n\n${USAGE}`);
      process.exitCode = 1;
      return;
    }

    const cwd = getWorkingDir();
    const print = values.print === true;

    if (target === 'folder') {
      const top = await gitExec(['rev-parse', '--show-toplevel'], cwd);
      const folder = top.exitCode === 0 ? top.stdout.trim() : cwd;
      if (print) console.log(folder);
      else revealPath(folder);
      return;
    }

    const remotes = await getRemotesDetail(cwd);
    const wanted = typeof values.remote === 'string' ? values.remote : undefined;
    //? Without --remote: origin when there is one, else whichever remote exists — a fork may
    //? only have `upstream`
    const remote = wanted
      ? remotes.find((entry) => entry.name === wanted)
      : (remotes.find((entry) => entry.name === 'origin') ?? remotes[0]);
    if (!remote) {
      console.error(
        wanted ? `❌ ${formatArg(wanted)} is not a remote.` : '❌ This repository has no remotes.',
      );
      process.exitCode = 1;
      return;
    }

    const branch = target === 'pr' ? await getBranch(cwd) : undefined;
    if (branch === 'HEAD') {
      console.error('❌ HEAD is detached — switch to a branch to open a pull request for it.');
      process.exitCode = 1;
      return;
    }

    const site = repoWebLinks(remote.fetchUrl, {
      branch,
      baseBranch: typeof values.base === 'string' ? values.base : undefined,
    });
    if (!site) {
      console.error(`❌ ${formatArg(remote.name)} (${remote.fetchUrl}) has no web page.`);
      process.exitCode = 1;
      return;
    }

    const url = site.links[target];
    if (!url) {
      console.error(
        `❌ giti does not know where ${formatArg(target)} lives on ${site.home}. Home page: ${site.home}`,
      );
      process.exitCode = 1;
      return;
    }

    if (print) console.log(url);
    else {
      console.log(`🌐 ${url}`);
      openUrl(url);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'open',
  description:
    'Open the repository in the browser — home, actions, pulls, issues, pages, settings, a new PR for the current branch — or its folder (--print to only print it)',
};

export default run;

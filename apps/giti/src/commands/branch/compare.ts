import { parseArgs } from 'node:util';
import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import type { CommandRun } from '../../types/CommandRun';
import getBranch from '../../utils/getBranch';
import getWorkingDir from '../../utils/getWorkingDir';
import gitExec from '../../utils/gitExec';

const USAGE = `Usage: giti branch compare <branch> [--diff] [--stat]

How the current branch stands against <branch>: commits on each side and the files the
current branch changed since they split. --stat adds line counts, --diff prints the full patch.`;

//? Status letters from `git diff --name-status`, as words a reader does not have to decode
const STATUS_LABEL: Record<string, string> = {
  A: formatColor('added   ', 'success'),
  M: formatColor('modified', 'info'),
  D: formatColor('deleted ', 'error'),
  R: formatColor('renamed ', 'warning'),
  C: formatColor('copied  ', 'warning'),
  T: formatColor('type    ', 'info'),
};

const run: CommandRun = async (args) => {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        diff: { type: 'boolean', default: false },
        stat: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      strict: false,
    });
    const [target] = positionals;
    if (values.help === true || !target) {
      console.log(USAGE);
      if (!target && values.help !== true) process.exitCode = 1;
      return;
    }

    const cwd = getWorkingDir();
    const current = await getBranch(cwd);

    const counts = await gitExec(['rev-list', '--left-right', '--count', `${target}...HEAD`], cwd);
    if (counts.exitCode !== 0) {
      console.error(`❌ Cannot compare with ${formatArg(target)}:`, counts.stderr);
      process.exitCode = 1;
      return;
    }
    const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map(Number);

    console.log(`🔀 ${formatArg(current)} vs ${formatArg(target)}`);
    console.log(`   ${formatColor(`↑${ahead}`, 'info')} commit(s) only on ${current}`);
    console.log(`   ${formatColor(`↓${behind}`, 'warning')} commit(s) only on ${target}`);

    //? Three dots: what this branch changed since it split from the target — the same view a
    //? pull request shows — rather than every difference, which would include the target's own work
    const range = `${target}...HEAD`;
    const names = await gitExec(['diff', '--name-status', '-M', range], cwd);
    const lines = names.stdout.split('\n').filter(Boolean);
    console.log(`\n📄 ${lines.length} file(s) changed on ${current}:`);
    for (const line of lines) {
      const [status = '', ...paths] = line.split('\t');
      const label = STATUS_LABEL[status[0] ?? ''] ?? status.padEnd(8);
      console.log(`   ${label} ${paths.join(' → ')}`);
    }

    if (values.stat === true) {
      console.log('');
      await gitExec(['diff', '--stat', '-M', range], cwd, { stream: true });
    }
    if (values.diff === true) {
      console.log('');
      await gitExec(['diff', '-M', range], cwd, { stream: true });
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch/compare',
  description:
    'Compare the current branch with another: commits ahead/behind and files changed since they split (--stat, --diff for more)',
};

export default run;

import { parseArgs } from 'node:util';
import formatArg from '@/dev-tools/utils/format/formatArg';
import formatColor from '@/dev-tools/utils/format/formatColor';
import type { CommandRun } from '../../types/CommandRun';
import getBranchOverview, { type BranchOverviewRow } from '../../utils/getBranchOverview';
import getDefaultBranch from '../../utils/getDefaultBranch';
import getWorkingDir from '../../utils/getWorkingDir';

const USAGE = `Usage: giti branch overview [--base=<branch>[,<branch>…]] [--local] [--remote=<name>]

Every branch against one or more base branches (default: the repo's trunk, e.g. main):
ahead/behind counts, which bases already contain it, and the age of its last commit.
Offline — run \`giti sync\` or \`git fetch\` first for an up-to-date picture.`;

const formatAge = (timestamp: number) => {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 86_400 * 60) return `${Math.round(seconds / 86_400)}d`;
  return `${Math.round(seconds / (86_400 * 30))}mo`;
};

const formatStanding = (row: BranchOverviewRow) =>
  Object.entries(row.divergence)
    .map(([base, { ahead, behind }]) => {
      if (row.mergedInto.includes(base) && ahead === 0)
        return formatColor(`merged → ${base}`, 'success');
      if (ahead === 0 && behind === 0) return formatColor(`= ${base}`, 'success');
      const parts = [
        ahead && formatColor(`↑${ahead}`, 'info'),
        behind && formatColor(`↓${behind}`, 'warning'),
      ];
      return `${parts.filter(Boolean).join(' ')} ${base}`;
    })
    .join('  ');

const run: CommandRun = async (args) => {
  try {
    const { values } = parseArgs({
      args,
      options: {
        base: { type: 'string', multiple: true },
        local: { type: 'boolean', default: false },
        remote: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      strict: false,
    });
    if (values.help === true) {
      console.log(USAGE);
      return;
    }

    const cwd = getWorkingDir();
    const remote = typeof values.remote === 'string' ? values.remote : 'origin';
    const given = (Array.isArray(values.base) ? values.base : [])
      .filter((value): value is string => typeof value === 'string')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    const bases = given.length ? given : [await getDefaultBranch(cwd, remote)].filter(Boolean);

    if (bases.length === 0) {
      console.error('❌ Could not tell which branch is the trunk — name it with --base=<branch>.');
      process.exitCode = 1;
      return;
    }

    const { rows, missingBases } = await getBranchOverview(cwd, bases, {
      remote,
      localOnly: values.local === true,
    });
    for (const base of missingBases)
      console.log(
        formatColor(`⚠️  Base ${base} exists neither locally nor on ${remote}`, 'warning'),
      );

    const width = Math.max(...rows.map((row) => row.name.length), 0);
    for (const row of rows) {
      const marker = row.isCurrent ? '* ' : '  ';
      const name = row.isBase ? formatArg(row.name.padEnd(width)) : row.name.padEnd(width);
      const where = row.isRemoteOnly ? formatColor(` [${remote}]`, 'debug') : '';
      const age = formatAge(row.timestamp).padStart(4);
      const standing = row.isBase ? formatColor('base', 'debug') : formatStanding(row);
      console.log(`${marker}${name}  ${row.shortHash}  ${age}  ${standing}${where}`);
      console.log(formatColor(`  ${' '.repeat(width)}  ${row.subject} — ${row.author}`, 'debug'));
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch/overview',
  description:
    'Every local and remote branch against base branches (--base, default the trunk): ahead/behind, merged, last-commit age',
};

export default run;

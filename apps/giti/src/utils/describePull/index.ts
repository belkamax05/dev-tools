import formatColor from '@/dev-tools/utils/format/formatColor';
import gitExec from '../gitExec';
import { plural } from '../vendored';

/** How many commit subjects to list before summarising the rest, as `mr update` does. */
const LISTED = 5;

/**
 * What a pull moved, as the lines to print after the directory's label: `pulled 2 commits
 * ecf1c64 → f02ccd1`, then the first few subjects, newest first as git log gives them.
 *
 * Works from two commits rather than from whatever the pull printed, because the three
 * mechanisms print completely different things — and a subrepo pull prints nothing about the
 * commits at all — while "where was it, where is it now" means the same for every one of them.
 *
 * @param from - Commit before the pull
 * @param to - Commit after it
 * @param cwd - A repository holding both commits (the submodule itself, or the parent)
 * @returns The summary line, then one line per listed subject
 */
const describePull = async (from: string, to: string, cwd: string): Promise<string[]> => {
  if (!from || !to || from === to) return [formatColor('up to date', 'success')];

  //? One `rev-parse --short` per commit: `--short` implies `--verify`, which takes exactly one
  //? revision, so asking for both at once silently answers for only the last.
  const short = async (commit: string) =>
    (await gitExec(['rev-parse', '--short', commit], cwd)).stdout.trim() || commit.slice(0, 7);

  const [counted, subjects, before, after] = await Promise.all([
    gitExec(['rev-list', '--count', `${from}..${to}`], cwd),
    gitExec(['log', '--format=%s', `--max-count=${LISTED}`, `${from}..${to}`], cwd),
    short(from),
    short(to),
  ]);

  const count = Number.parseInt(counted.stdout.trim(), 10);
  const moved = Number.isNaN(count) ? 'pulled' : `pulled ${plural(count, 'commit')}`;

  const lines = [`${formatColor(moved, 'success')}  ${before} → ${after}`];
  for (const subject of subjects.stdout.split('\n').filter(Boolean)) lines.push(`  • ${subject}`);
  if (count > LISTED) lines.push(`  … and ${count - LISTED} more`);
  return lines;
};

export default describePull;

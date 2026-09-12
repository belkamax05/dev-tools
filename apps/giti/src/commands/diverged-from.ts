import palette from '@/dev-tools/config/color/palette';
import standard from '@/dev-tools/config/color/standard';
import { styles } from '@/dev-tools/config/color/styles';
import type { CommandRun } from '../types/CommandRun';
import getBranch from '../utils/getBranch';
import getBranches from '../utils/getBranches';
import getCommitCount from '../utils/getCommitCount';
import getCommitSubject from '../utils/getCommitSubject';
import getMergeBase from '../utils/getMergeBase';
import getShortHash from '../utils/getShortHash';
import getWorkingDir from '../utils/getWorkingDir';

interface DivergedBranch {
  branch: string;
  mergeBase: string;
  mergeBaseSubject: string;
  currentAhead: number;
  branchAhead: number;
}

const run: CommandRun = async () => {
  const cwd = getWorkingDir();
  const [currentBranch, { local: allLocal }] = await Promise.all([
    getBranch(cwd),
    getBranches(cwd),
  ]);

  const candidates = allLocal.filter((b) => b !== currentBranch);

  if (candidates.length === 0) {
    console.log('No other local branches to compare against.');
    return;
  }

  const results = await Promise.all(
    candidates.map(async (branch): Promise<DivergedBranch | null> => {
      const mergeBase = await getMergeBase(cwd, currentBranch, branch);
      if (!mergeBase) return null;

      const [currentAhead, branchAhead, mergeBaseSubject, shortHash] = await Promise.all([
        getCommitCount(cwd, `${mergeBase}..HEAD`),
        getCommitCount(cwd, `${mergeBase}..${branch}`),
        getCommitSubject(cwd, mergeBase),
        getShortHash(cwd, mergeBase),
      ]);

      return { branch, mergeBase: shortHash, mergeBaseSubject, currentAhead, branchAhead };
    }),
  );

  const valid = (results.filter(Boolean) as DivergedBranch[]).sort(
    (a, b) => a.currentAhead - b.currentAhead,
  );

  if (valid.length === 0) {
    console.log('No common ancestors found with any local branch.');
    return;
  }

  const R = styles.reset;
  const B = styles.bold;
  const DIM = styles.dim;
  const cyan = palette.cyan;
  const green = standard.success;
  const yellow = standard.warning;
  const gray = palette.dark_gray;

  console.log(`${B}Divergence from: ${cyan}${currentBranch}${R}\n`);

  for (const entry of valid) {
    const closestLabel = entry === valid[0] ? ` ${green}← closest${R}` : '';
    console.log(`  ${B}${cyan}${entry.branch}${R}${closestLabel}`);
    console.log(
      `  ${gray}merge base :${R} ${yellow}${entry.mergeBase}${R}  ${DIM}${entry.mergeBaseSubject}${R}`,
    );
    console.log(
      `  ${gray}you are   :${R} ${B}${entry.currentAhead}${R} commit(s) ahead of the fork`,
    );
    console.log(
      `  ${gray}they are  :${R} ${B}${entry.branchAhead}${R} commit(s) ahead of the fork`,
    );
    console.log('');
  }
};

export const meta = {
  name: 'diverged-from',
  description:
    'Show which local branches share a common ancestor with the current branch, ranked by closeness',
};

export default run;

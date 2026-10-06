import { isCancel, select } from '@clack/prompts';
import type { CommandRun } from '../../types/CommandRun';
import copyBranch from '../../utils/copyBranch';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const { current, others } = await getOtherLocalBranches(rootDir);

    let branch = args[0];

    if (!branch) {
      if (others.length === 0) {
        console.log('No other local branches to copy from.');
        return;
      }

      const choice = await select({
        message: `Select a branch to copy into working tree (current: ${current}):`,
        options: others.map((b) => ({ value: b, label: b })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      branch = choice as string;
    }

    console.log(`📋 Copying changes from '${branch}' (unstaged)...`);
    const result = await copyBranch(rootDir, branch);

    if (result.exitCode === 0) {
      console.log(`✅ Changes from '${branch}' are now in your working tree (unstaged).`);
    } else {
      console.error('❌ Copy failed:', result.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-copy',
  description: 'Apply the diff of another branch into the working tree as unstaged changes',
};

export default run;

import { isCancel, select } from '@clack/prompts';
import type { CommandRun } from '../../types/CommandRun';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';
import switchBranch from '../../utils/switchBranch';

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const { current, others } = await getOtherLocalBranches(rootDir);

    let branch = args[0];

    if (!branch) {
      if (others.length === 0) {
        console.log('No other local branches to switch to.');
        return;
      }

      const choice = await select({
        message: `Select a branch to switch to (current: ${current}):`,
        options: others.map((b) => ({ value: b, label: b })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      branch = choice as string;
    }

    const result = await switchBranch(rootDir, branch);

    if (result.exitCode === 0) {
      console.log(`✅ Switched to branch '${branch}'.`);
    } else {
      console.error('❌ Switch failed:', result.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-switch',
  description: 'Switch to a local branch by name or pick one interactively',
};

export default run;

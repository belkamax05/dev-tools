import { confirm, isCancel, select } from '@clack/prompts';
import type { CommandRun } from '../../types/CommandRun';
import deleteBranch from '../../utils/deleteBranch';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getWorkingDir from '../../utils/getWorkingDir';
import tryDeleteBranch from '../../utils/tryDeleteBranch';

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const { others } = await getOtherLocalBranches(rootDir);

    let branch = args[0];

    if (!branch) {
      if (others.length === 0) {
        console.log('No other local branches to remove.');
        return;
      }

      const choice = await select({
        message: 'Select a branch to remove:',
        options: others.map((b) => ({ value: b, label: b })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      branch = choice as string;
    }

    const result = await tryDeleteBranch(rootDir, branch);

    if (result.exitCode === 0) {
      console.log(`✅ Deleted branch '${branch}'.`);
      return;
    }

    if (result.notFullyMerged) {
      console.warn(`⚠️  Branch '${branch}' is not fully merged.`);
      const force = await confirm({ message: 'Force delete it anyway?' });

      if (isCancel(force) || !force) {
        console.log('Cancelled.');
        return;
      }

      const forceResult = await deleteBranch(rootDir, branch, true);
      if (forceResult.exitCode === 0) {
        console.log(`✅ Force deleted branch '${branch}'.`);
      } else {
        console.error('❌ Force delete failed:', forceResult.stderr);
      }
    } else {
      console.error('❌ Delete failed:', result.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-remove',
  description:
    'Delete a local branch by name or pick one interactively; prompts to force-delete if not fully merged',
};

export default run;

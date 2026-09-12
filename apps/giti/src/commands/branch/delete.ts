import { confirm, isCancel, select } from '@clack/prompts';
import type { CommandRun } from '../../types/CommandRun';
import deleteBranch from '../../utils/deleteBranch';
import deleteRemoteBranch from '../../utils/deleteRemoteBranch';
import getBranches from '../../utils/getBranches';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getRemotes from '../../utils/getRemotes';
import getWorkingDir from '../../utils/getWorkingDir';
import tryDeleteBranch from '../../utils/tryDeleteBranch';

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const { others } = await getOtherLocalBranches(rootDir);

    let branch = args[0];

    if (!branch) {
      if (others.length === 0) {
        console.log('No other local branches to delete.');
        return;
      }

      const choice = await select({
        message: 'Select a branch to delete:',
        options: others.map((b) => ({ value: b, label: b })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      branch = choice as string;
    }

    const { remote: remoteBranches } = await getBranches(rootDir);
    const remotes = await getRemotes(rootDir);
    const trackedRemote = remotes.find((r) => remoteBranches.includes(`${r}/${branch}`));

    const result = await tryDeleteBranch(rootDir, branch);

    if (result.exitCode !== 0) {
      if (!result.notFullyMerged) {
        console.error('❌ Delete failed:', result.stderr);
        return;
      }

      console.warn(`⚠️  Branch '${branch}' is not fully merged.`);
      const force = await confirm({ message: 'Force delete it anyway?' });

      if (isCancel(force) || !force) {
        console.log('Cancelled.');
        return;
      }

      const forceResult = await deleteBranch(rootDir, branch, true);
      if (forceResult.exitCode !== 0) {
        console.error('❌ Force delete failed:', forceResult.stderr);
        return;
      }

      console.log(`✅ Force deleted local branch '${branch}'.`);
    } else {
      console.log(`✅ Deleted local branch '${branch}'.`);
    }

    if (!trackedRemote) return;

    const deleteRemote = await confirm({
      message: `Also delete '${trackedRemote}/${branch}' on the remote?`,
    });

    if (isCancel(deleteRemote) || !deleteRemote) {
      console.log(`ℹ️  Left '${trackedRemote}/${branch}' untouched.`);
      return;
    }

    console.log(`🗑️  Deleting remote branch '${trackedRemote}/${branch}'...`);
    const remoteResult = await deleteRemoteBranch(rootDir, trackedRemote, branch);

    if (remoteResult.exitCode === 0) {
      console.log(`✅ Deleted '${trackedRemote}/${branch}'.`);
    } else {
      console.error('❌ Remote delete failed:', remoteResult.stderr);
    }
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-delete',
  description:
    'Delete a local branch by name or pick one interactively (prompts to force-delete if not fully merged), then optionally delete its remote counterpart too',
};

export default run;

import { confirm, isCancel, select, text } from '@clack/prompts';
import type { CommandRun } from '../../types/CommandRun';
import deleteRemoteBranch from '../../utils/deleteRemoteBranch';
import getBranches from '../../utils/getBranches';
import getOtherLocalBranches from '../../utils/getOtherLocalBranches';
import getRemotes from '../../utils/getRemotes';
import getWorkingDir from '../../utils/getWorkingDir';
import pushBranch from '../../utils/pushBranch';
import renameBranch from '../../utils/renameBranch';

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const { current, others } = await getOtherLocalBranches(rootDir);

    let oldBranch = args[0];
    let newBranch = args[1];

    //? A single positional arg renames the current branch, mirroring `git branch -m <new>`.
    if (oldBranch && !newBranch) {
      newBranch = oldBranch;
      oldBranch = current;
    }

    if (!oldBranch) {
      const choice = await select({
        message: `Select a branch to rename (current: ${current}):`,
        options: [current, ...others].map((b) => ({
          value: b,
          label: b === current ? `${b} (current)` : b,
        })),
      });

      if (isCancel(choice)) {
        console.log('Cancelled.');
        return;
      }

      oldBranch = choice as string;
    }

    if (!newBranch) {
      const input = await text({
        message: `New name for '${oldBranch}':`,
        validate: (value) => {
          if (!value?.trim()) return 'Branch name is required.';
        },
      });

      if (isCancel(input)) {
        console.log('Cancelled.');
        return;
      }

      newBranch = (input as string).trim();
    }

    if (oldBranch === newBranch) {
      console.log('New name is the same as the old name — nothing to do.');
      return;
    }

    const { local, remote: remoteBranches } = await getBranches(rootDir);

    if (local.includes(newBranch)) {
      console.error(`❌ Branch '${newBranch}' already exists locally.`);
      return;
    }

    console.log(`✏️  Renaming '${oldBranch}' → '${newBranch}'...`);
    const renameResult = await renameBranch(rootDir, oldBranch, newBranch);

    if (renameResult.exitCode !== 0) {
      console.error('❌ Rename failed:', renameResult.stderr);
      return;
    }

    const remotes = await getRemotes(rootDir);
    const trackedRemote = remotes.find((r) => remoteBranches.includes(`${r}/${oldBranch}`));

    if (!trackedRemote) {
      console.log(`✅ Renamed local branch '${oldBranch}' to '${newBranch}'.`);
      return;
    }

    const moveRemote = await confirm({
      message: `Also rename on the remote ('${trackedRemote}/${oldBranch}' → '${trackedRemote}/${newBranch}')?`,
    });

    if (isCancel(moveRemote) || !moveRemote) {
      console.log(`✅ Renamed local branch '${oldBranch}' to '${newBranch}'.`);
      console.log(`ℹ️  Left '${trackedRemote}/${oldBranch}' untouched.`);
      return;
    }

    console.log(`🚀 Pushing '${newBranch}' to '${trackedRemote}'...`);
    const pushResult = await pushBranch(rootDir, trackedRemote, newBranch);

    if (pushResult.exitCode !== 0) {
      console.error('❌ Push failed:', pushResult.stderr);
      console.log(`ℹ️  Local branch renamed, but '${trackedRemote}/${oldBranch}' was not updated.`);
      return;
    }

    console.log(`🗑️  Deleting old remote branch '${trackedRemote}/${oldBranch}'...`);
    const deleteResult = await deleteRemoteBranch(rootDir, trackedRemote, oldBranch);

    if (deleteResult.exitCode !== 0) {
      console.error('❌ Failed to delete old remote branch:', deleteResult.stderr);
      console.log(
        `ℹ️  '${newBranch}' is pushed and tracked; delete '${trackedRemote}/${oldBranch}' manually.`,
      );
      return;
    }

    console.log(`✅ Renamed '${oldBranch}' → '${newBranch}' (local + ${trackedRemote}).`);
    console.log(`ℹ️  Other contributors should run: git fetch ${trackedRemote} --prune`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'branch-move',
  description:
    "Rename a local branch and its remote counterpart (push new name, delete old remote branch, retarget tracking). Pass one name to rename the current branch, or 'old new' to rename any branch",
};

export default run;

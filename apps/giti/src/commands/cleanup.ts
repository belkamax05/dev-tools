import { confirm, isCancel } from '@clack/prompts';
import type { CommandRun } from '../types/CommandRun';
import deleteBranch from '../utils/deleteBranch';
import getBranch from '../utils/getBranch';
import getMergedBranches from '../utils/getMergedBranches';
import getWorkingDir from '../utils/getWorkingDir';

const PROTECTED_BRANCHES = [
  'main',
  'master',
  'dev',
  'develop',
  'development',
  'staging',
  'production',
];

const run: CommandRun = async (args) => {
  try {
    const rootDir = getWorkingDir();
    const dryRun = args.includes('--dry-run') || args.includes('-n');
    const assumeYes = args.includes('--yes') || args.includes('-y');

    const currentBranch = await getBranch(rootDir);
    const mergedBranches = await getMergedBranches(rootDir, currentBranch);

    const branchesToDelete = mergedBranches.filter(
      (b) => !PROTECTED_BRANCHES.includes(b) && b !== currentBranch,
    );

    if (branchesToDelete.length === 0) {
      console.log('✨ No merged branches to delete.');
      return;
    }

    console.log(
      `Merged into ${currentBranch}, so already contained in it (${branchesToDelete.length}):`,
    );
    for (const branch of branchesToDelete) console.log(`  - ${branch}`);

    if (dryRun) {
      console.log('\nℹ️  --dry-run: nothing was deleted.');
      return;
    }

    //? Deleting branches is the one thing here that cannot be undone from the CLI, so it asks.
    //? Without a TTY there is nobody to ask, and silently deleting would be the worst of the
    //? three options — so it stops and names the flag that means "I meant it".
    if (!assumeYes) {
      if (!process.stdin.isTTY) {
        console.log('\nℹ️  Not an interactive terminal — re-run with --yes to delete these.');
        return;
      }

      const proceed = await confirm({
        message: `Delete ${branchesToDelete.length} local branch(es)?`,
      });
      if (isCancel(proceed) || !proceed) {
        console.log('Cancelled — nothing deleted.');
        return;
      }
    }

    let deleted = 0;
    for (const branch of branchesToDelete) {
      const result = await deleteBranch(rootDir, branch);
      if (result.exitCode === 0) {
        console.log(`✅ Deleted ${branch}`);
        deleted += 1;
      } else {
        console.error(`❌ Failed to delete ${branch}:`, result.stderr);
      }
    }

    console.log(`✨ Cleanup complete — ${deleted} of ${branchesToDelete.length} deleted.`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'cleanup',
  description:
    'Delete local branches already merged into the current one, after showing them and asking (--dry-run to preview, --yes to skip the prompt)',
};

export default run;

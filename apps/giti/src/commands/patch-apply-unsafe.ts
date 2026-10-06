import { join } from 'node:path';
import { isCancel, select } from '@clack/prompts';
import type { CommandRun } from '../types/CommandRun';
import applyPatch from '../utils/applyPatch';
import cancelAllChanges from '../utils/cancelAllChanges';
import getPatchFiles from '../utils/getPatchFiles';
import getWorkingDir from '../utils/getWorkingDir';

/** Normalises a user-supplied name: strips any existing .patch suffix, then re-adds it. */
const normalizePatchName = (name: string): string => `${name.replace(/\.patch$/i, '')}.patch`;

/**
 * Resolves the patch filename from an optional CLI argument or an interactive
 * picker showing all *.patch files in the current working directory.
 * Returns `null` when the user cancels or no patches are available.
 */
const resolvePatchName = async (cwd: string, arg?: string): Promise<string | null> => {
  if (arg) return normalizePatchName(arg);

  const patches = getPatchFiles(cwd);

  if (patches.length === 0) {
    console.log('ℹ️  No .patch files found in the current directory.');
    return null;
  }

  const choice = await select({
    message: 'Select a patch to apply:',
    options: patches.map((p) => ({ value: p, label: p })),
  });

  if (isCancel(choice)) {
    console.log('Cancelled.');
    return null;
  }

  return choice as string;
};

const run: CommandRun = async (args) => {
  try {
    const cwd = getWorkingDir();

    const filename = await resolvePatchName(cwd, args[0]);
    if (!filename) return;

    console.log('🧹 Reverting all changes before applying patch (*.patch files preserved)...');
    const counts = await cancelAllChanges(cwd);
    const total = counts.newlyAdded + counts.staged + counts.modified + counts.untracked;
    if (total > 0) {
      if (counts.staged > 0) console.log(`   staged:    ${counts.staged} file(s)`);
      if (counts.newlyAdded > 0) console.log(`   new:       ${counts.newlyAdded} file(s)`);
      if (counts.modified > 0) console.log(`   modified:  ${counts.modified} file(s)`);
      if (counts.untracked > 0) console.log(`   untracked: ${counts.untracked} file(s)`);
      console.log('✅ Working tree cleared.');
    } else {
      console.log('   (already clean)');
    }

    console.log(`🔄 Applying patch: ${filename}`);
    await applyPatch(cwd, join(cwd, filename));

    console.log(`✅ Patch applied: ${filename}`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'patch-apply-unsafe',
  description:
    'Cancel all tracked changes (revert to HEAD), then apply a .patch file. Newly-added staged files are deleted; untracked files are left as-is; *.patch files are preserved.',
};

export default run;

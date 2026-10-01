import type { CommandRun } from '../types/CommandRun';
import discardChanges from '../utils/discardChanges';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import parsePorcelainStatus from '../utils/parsePorcelainStatus';
import resolveRepoPaths from '../utils/resolveRepoPaths';

const run: CommandRun = async (paths) => {
  try {
    //? Status paths are relative to the repository root, so restore runs from there and the
    //? typed paths are rewritten to match
    const { root: cwd, paths: requestedPaths } = await resolveRepoPaths(getWorkingDir(), paths);

    const raw = await getStatus(cwd);
    const { modified } = parsePorcelainStatus(raw);

    //? Only working-tree changes, skip *.patch files. Named paths narrow it further, but only to
    //? files that really have unstaged edits — `git restore` on anything else would either fail
    //? or, for a folder, quietly sweep up changes nobody named
    const requested = new Set(requestedPaths);
    const targets = modified
      .filter((e) => !e.path.endsWith('.patch'))
      .filter((e) => requested.size === 0 || requested.has(e.path))
      .map((e) => e.path);
    const skipped = [...requested].filter((path) => !targets.includes(path));
    if (skipped.length > 0) console.log(`ℹ️  No unstaged changes in: ${skipped.join(', ')}`);

    if (targets.length === 0) {
      console.log('ℹ️  No unstaged changes to cancel.');
      return;
    }

    console.log(`🔄 Discarding ${targets.length} unstaged file(s) (staged changes untouched)...`);
    await discardChanges(cwd, targets);

    console.log('✅ Unstaged changes discarded.');
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'cancel-unstaged',
  description:
    'Discard working-tree (unstaged) changes — all of them, or only the paths given; staged files and *.patch files are left untouched',
};

export default run;

import type { CommandRun } from '../types/CommandRun';
import discardChanges from '../utils/discardChanges';
import getStatus from '../utils/getStatus';
import getWorkingDir from '../utils/getWorkingDir';
import parsePorcelainStatus from '../utils/parsePorcelainStatus';

const run: CommandRun = async () => {
  try {
    const cwd = getWorkingDir();

    const raw = await getStatus(cwd);
    const { modified } = parsePorcelainStatus(raw);

    // Only working-tree changes, skip *.patch files
    const targets = modified.filter((e) => !e.path.endsWith('.patch')).map((e) => e.path);

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
    'Discard only working-tree (unstaged) changes; staged files and *.patch files are left untouched',
};

export default run;

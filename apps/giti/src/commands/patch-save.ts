import { join } from 'node:path';
import { isCancel, text } from '@clack/prompts';
import type { CommandRun } from '../types/CommandRun';
import createPatch from '../utils/createPatch';
import getWorkingDir from '../utils/getWorkingDir';
import isDirty from '../utils/isDirty';

/** Normalises a user-supplied name: strips any existing .patch suffix, then re-adds it. */
const normalizePatchName = (name: string): string => `${name.replace(/\.patch$/i, '')}.patch`;

/** Returns a readable, filesystem-safe timestamp like "2024-01-15_14-30-25". */
const makeTimestamp = (): string =>
  new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');

const run: CommandRun = async (args) => {
  try {
    const cwd = getWorkingDir();

    const dirty = await isDirty(cwd);
    if (!dirty) {
      console.log('ℹ️  Nothing to patch — working tree is clean.');
      return;
    }

    let name = args[0];

    if (!name) {
      const defaultName = makeTimestamp();
      const input = await text({
        message: 'Patch name (without extension):',
        placeholder: defaultName,
        defaultValue: defaultName,
      });

      if (isCancel(input)) {
        console.log('Cancelled.');
        return;
      }

      name = (input as string).trim() || defaultName;
    }

    const filename = normalizePatchName(name);
    const outputPath = join(cwd, filename);

    await createPatch(cwd, outputPath);

    console.log(`✅ Patch saved: ${filename}`);
  } catch (error) {
    console.error('❌ Operation failed:', (error as Error).message);
  }
};

export const meta = {
  name: 'patch-save',
  description:
    'Save all tracked changes (staged + unstaged) to a .patch file. Untracked files are excluded — git add them first if needed.',
};

export default run;

import { readdirSync } from 'node:fs';

/**
 * Returns all .patch filenames present in the given directory (names only, not full paths).
 * Returns an empty array if the directory cannot be read.
 */
const getPatchFiles = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.patch'));
  } catch {
    return [];
  }
};

export default getPatchFiles;

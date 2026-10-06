import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Resolve the root of the repository this code is installed in.
 *
 * ! Never falls back to `process.cwd()`. Adapted from shulker-controller's `getInstallRootDir`,
 * ! which carries the same warning for the same reason: the root has to come from the location of
 * ! the code itself, otherwise the git hashes built on top of it describe whatever repository the
 * ! user happens to be standing in instead of the repository the code belongs to.
 *
 * The controller strips a `system/` path segment because its framework always installs under one.
 * giti has no such segment, so the equivalent anchor is the nearest `package.json` above this
 * module.
 *
 * @param fromDir - Directory inside the repo (defaults to this module's own directory)
 * @returns Absolute path to the repository root
 * @throws When no `package.json` exists at or above `fromDir`
 */
const getRepoRootDir = (fromDir: string = import.meta.dir): string => {
  const startDir = resolve(fromDir);

  let dir = startDir;
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Unable to resolve repository root from ${startDir}: no package.json above it.`,
      );
    }
    dir = parent;
  }

  return dir;
};

export default getRepoRootDir;

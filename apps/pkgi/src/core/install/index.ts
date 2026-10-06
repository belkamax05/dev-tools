import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import type { PackageManagerName } from '../../config/settings';

/**
 * What the last `pkgi install` in a folder installed from. Kept inside `node_modules`, so deleting
 * that folder forgets it too — and a lockfile that changed since (a pull, a branch switch) no
 * longer matches it.
 */
export interface InstallStamp {
  manager: PackageManagerName;
  lockfile: string;
  hash: string;
  /** The Nix build this node_modules was copied from, when `pkgi install --nix` put it there. */
  store?: string;
}

export const stampPath = (dir: string) => join(dir, 'node_modules', '.pkgi-install.json');

export const hashFile = async (path: string) =>
  new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex');

const currentStamp = async (
  manager: PackageManagerName,
  lockfile: string,
): Promise<InstallStamp> => ({
  manager,
  lockfile: basename(lockfile),
  hash: await hashFile(lockfile),
});

/**
 * True when `node_modules` was last installed by pkgi from exactly this lockfile, by this manager
 * — with `fromNix`, only when it was copied from a Nix build of it that is still in the store.
 */
export const isInstallCurrent = async (
  dir: string,
  manager: PackageManagerName,
  lockfile: string | undefined,
  { fromNix = false }: { fromNix?: boolean } = {},
): Promise<boolean> => {
  if (!lockfile || !existsSync(stampPath(dir))) return false;
  try {
    const stamp = (await Bun.file(stampPath(dir)).json()) as Partial<InstallStamp>;
    const now = await currentStamp(manager, lockfile);
    if (fromNix && !(stamp.store && existsSync(stamp.store))) return false;
    return (
      stamp.manager === now.manager && stamp.lockfile === now.lockfile && stamp.hash === now.hash
    );
  } catch {
    return false;
  }
};

export const writeInstallStamp = async (
  dir: string,
  manager: PackageManagerName,
  lockfile: string,
  store?: string,
) => {
  const stamp: InstallStamp = {
    ...(await currentStamp(manager, lockfile)),
    ...(store && { store }),
  };
  await mkdir(dirname(stampPath(dir)), { recursive: true });
  await writeFile(stampPath(dir), `${JSON.stringify(stamp)}\n`);
};

/**
 * The version of `manager` on `PATH` when it differs from the one `packageManager` pins, so a
 * caller can say the install may not match one made with the pinned version. Undefined when they
 * agree, when nothing is pinned, or when the manager cannot be asked.
 */
export const managerVersionMismatch = async (
  manager: PackageManagerName,
  wanted: string | undefined,
): Promise<string | undefined> => {
  if (!wanted) return undefined;
  const result = await exec([manager, '--version']);
  if (result.exitCode !== 0) return undefined;
  const actual = result.stdout.trim().replace(/^v/, '');
  return actual === wanted ? undefined : actual;
};

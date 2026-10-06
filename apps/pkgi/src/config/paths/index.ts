import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { appStateDir } from '@/dev-tools/utils/config/configHome';

/**
 * Where this platform keeps caches: data that can be thrown away and fetched again.
 *
 * Registry answers are not settings and not state — deleting them costs one slower run — so they
 * go where a disk cleaner is entitled to delete them: `XDG_CACHE_HOME` on Linux, `~/Library/Caches`
 * on macOS, `%LOCALAPPDATA%` on Windows.
 */
export const cacheHome = (): string => {
  const home = homedir();
  if (process.platform === 'win32')
    return process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  if (process.platform === 'darwin') return join(home, 'Library', 'Caches');
  return process.env.XDG_CACHE_HOME || join(home, '.cache');
};

export const pkgiCacheDir = (): string => join(cacheHome(), 'pkgi');

/**
 * The default per-folder state file: one file per folder pkgi has been run in, under pkgi's state
 * directory rather than in the folder itself.
 *
 * Named after the folder with a short hash of its full path — the folder name for whoever lists
 * the directory, the hash so two `app` folders in different places never share notes.
 */
export const defaultFolderStateFile = (dir: string): string => {
  const hash = createHash('sha1').update(dir).digest('hex').slice(0, 10);
  const name = basename(dir).replace(/[^\w.-]+/g, '_') || 'root';
  return join(appStateDir('pkgi'), 'folders', `${name}-${hash}.json`);
};

import { type FSWatcher, watch } from 'node:fs';
import { join, sep } from 'node:path';
import { useEffect, useRef } from 'react';

/** How long a burst of file events is gathered into one refresh. */
const SETTLE_MS = 300;

/**
 * Paths that change constantly without meaning anything for a git dashboard:
 * git's object store and lock files, and dependency folders.
 */
const isNoise = (path: string) =>
  path.startsWith(`.git${sep}objects`) ||
  path.startsWith(`.git${sep}logs`) ||
  path.endsWith('.lock') ||
  path.includes(`node_modules${sep}`) ||
  path.startsWith('node_modules');

/**
 * Call `onChange` whenever the repository changes — a save in an editor, a
 * commit in another terminal, a checkout — so the dashboard never shows
 * something stale and needs no refresh key.
 *
 * One recursive watch on the working tree, which includes `.git`; where the
 * platform cannot watch recursively (or runs out of watches in a huge tree),
 * it falls back to watching `.git` alone, which still catches every git
 * operation. Events are gathered for a moment so a checkout touching
 * thousands of files is one refresh, not thousands.
 */
export const useRepoWatch = (root: string | undefined, onChange: () => void) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = (path: string | null) => {
      if (path && isNoise(path)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => onChangeRef.current(), SETTLE_MS);
    };

    let watcher: FSWatcher | undefined;
    try {
      watcher = watch(root, { recursive: true }, (_event, file) => fire(file?.toString() ?? null));
    } catch {
      try {
        watcher = watch(join(root, '.git'), { recursive: true }, (_event, file) =>
          fire(file ? `.git${sep}${file.toString()}` : null),
        );
      } catch {
        watcher = undefined;
      }
    }
    watcher?.on('error', () => {});

    return () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    };
  }, [root]);
};

export default useRepoWatch;

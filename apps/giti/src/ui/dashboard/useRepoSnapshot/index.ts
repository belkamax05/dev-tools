import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoSnapshot } from '../../../utils/getRepoSnapshot';
import getRepoSnapshot from '../../../utils/getRepoSnapshot';

export interface RepoSnapshotState {
  /** Undefined until the first read lands — every view guards on this. */
  snapshot: RepoSnapshot | undefined;
  /** True while a read is in flight, the first one included. */
  isLoading: boolean;
  /** Set when a read threw outright, which `getRepoSnapshot` tries hard not to do. */
  error: string | undefined;
  refresh: () => void;
}

/**
 * The repository, re-read on demand.
 *
 * Deliberately not polled. A dashboard that refreshes itself runs a dozen git
 * commands every few seconds for the whole time it is open, and the moments its
 * numbers actually change are moments the user caused — so refreshing is a key
 * they press, and the snapshot carries `takenAt` so the header can say how old
 * what they are looking at is.
 *
 * The previous snapshot is kept on screen while the next one is read. Blanking
 * the panes for the length of a refresh makes a fast operation look like a
 * failure, and there is nothing useful to put in their place.
 */
export const useRepoSnapshot = (cwd: string): RepoSnapshotState => {
  const [snapshot, setSnapshot] = useState<RepoSnapshot | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  //? Guards the state updates rather than the read: an unmount mid-refresh would
  //? otherwise set state on a component that is gone, and on the way out of a
  //? TUI that is every refresh still in flight.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * One read, and the only thing that writes any of the state above.
   *
   * The effect calls this and so does `refresh`, rather than a refresh bumping a
   * counter the effect depends on. The counter version reads as the same thing
   * but is not: the counter is never referenced in the effect body, so it is an
   * "extra dependency" that a lint autofix will helpfully delete — taking the
   * refresh button with it, silently, because the code still compiles and still
   * renders.
   */
  const load = useCallback(() => {
    setIsLoading(true);
    getRepoSnapshot(cwd)
      .then((next) => {
        if (!mounted.current) return;
        setSnapshot(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (mounted.current) setIsLoading(false);
      });
  }, [cwd]);

  useEffect(() => {
    load();
  }, [load]);

  return { snapshot, isLoading, error, refresh: load };
};

export default useRepoSnapshot;

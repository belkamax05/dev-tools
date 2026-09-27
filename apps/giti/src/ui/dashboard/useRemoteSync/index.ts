import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAll, pullMega, pushCurrent } from '../../../core/remotes';
import type { OperationResult } from '../../../core/status';
import type { Tone } from '../types';

export interface LastFetch {
  at: Date;
  ok: boolean;
}

export interface RemoteSync {
  /** What is running right now, with git's latest progress line — undefined when idle. */
  progress: string | undefined;
  /** The last fetch this process made of this repository, automatic or not. */
  lastFetch: LastFetch | undefined;
  fetch: () => void;
  pull: () => void;
  push: () => void;
}

/**
 * Per process, not per mount: the dashboard is torn down and rebuilt around every handoff to an
 * editor, and coming back from one must neither fetch again nor forget when the last one was.
 */
const autoFetched = new Set<string>();
const lastFetches = new Map<string, LastFetch>();

/**
 * Fetch, pull and push for the current branch, plus one automatic fetch when the dashboard opens.
 *
 * The automatic fetch is what makes ↑/↓ mean something: without it they compare against whatever
 * the last manual fetch saw, which can be days old, and "up to date" is a claim about the
 * remote the dashboard never actually asked. It runs in the background and quietly — a network
 * that is down costs a warning in the status line, not a blocked dashboard.
 *
 * Lives at App level rather than in a view so a fetch keeps running, and its result lands, when
 * the user switches tabs half-way through it.
 *
 * @param root - The repository, or undefined until the first snapshot says there is one
 * @param remote - Where a branch with no upstream is pushed to (and set to track)
 */
export const useRemoteSync = (
  root: string | undefined,
  {
    notify,
    reload,
    remote = 'origin',
  }: { notify: (message: string, tone?: Tone) => void; reload: () => void; remote?: string },
): RemoteSync => {
  const [progress, setProgress] = useState<string | undefined>(undefined);
  const [lastFetch, setLastFetch] = useState<LastFetch | undefined>(
    root ? lastFetches.get(root) : undefined,
  );

  //? Set state only while mounted: a fetch outlives a handoff, and landing on a component that
  //? is already gone is a React warning at best.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const busy = useRef(false);
  const run = useCallback(
    async (
      label: string,
      action: (onProgress: (line: string) => void) => Promise<OperationResult>,
      { quiet = false }: { quiet?: boolean } = {},
    ) => {
      if (!root || busy.current) return undefined;
      busy.current = true;
      setProgress(`${label}…`);
      try {
        const result = await action((line) => {
          if (mounted.current) setProgress(`${label}: ${line}`);
        });
        //? A quiet run reports only a failure — the automatic fetch is not something the user
        //? did, so its success is shown in the sync line rather than claiming the status line.
        if (!quiet || !result.ok) {
          notify(
            result.ok
              ? result.message
              : quiet
                ? `Couldn't fetch: ${result.message}`
                : result.message,
            result.ok ? 'ok' : quiet ? 'warn' : 'error',
          );
        }
        return result;
      } finally {
        busy.current = false;
        if (mounted.current) setProgress(undefined);
        reload();
      }
    },
    [root, notify, reload],
  );

  const fetchWith = useCallback(
    async (quiet: boolean) => {
      if (!root) return;
      const result = await run('Fetching', (onProgress) => fetchAll(root, onProgress), { quiet });
      if (!result) return;
      const done = { at: new Date(), ok: result.ok };
      lastFetches.set(root, done);
      if (mounted.current) setLastFetch(done);
    },
    [root, run],
  );

  useEffect(() => {
    if (!root || autoFetched.has(root)) return;
    autoFetched.add(root);
    void fetchWith(true);
  }, [root, fetchWith]);

  return {
    progress,
    lastFetch,
    fetch: () => void fetchWith(false),
    pull: () => {
      if (root) void run('Mega pull', (onProgress) => pullMega(root, onProgress));
    },
    push: () => {
      if (root) void run('Pushing', (onProgress) => pushCurrent(root, { remote, onProgress }));
    },
  };
};

export default useRemoteSync;

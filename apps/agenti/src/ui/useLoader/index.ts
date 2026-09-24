import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoaderState<T> {
  /** Undefined until the first load lands. The previous value is kept during a reload. */
  data: T | undefined;
  isLoading: boolean;
  error: string | undefined;
  reload: () => void;
}

/**
 * Load something once, and again on demand.
 *
 * The same shape as giti's `useRepoSnapshot`, generalised: not polled (the
 * moments these change are moments the user caused), and the old value stays
 * on screen while the next is read, so a reload never blanks a pane. `load` is
 * read through a ref so a caller can pass an inline function without it
 * becoming a dependency that reloads on every render.
 */
export const useLoader = <T>(
  load: () => T | Promise<T>,
  deps: readonly unknown[],
): LoaderState<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const reload = useCallback(() => {
    //? A slow load finishing after a faster, later one must not overwrite it —
    //? switching IDE mid-load would otherwise show the old IDE's inventory
    const current = ++generation.current;
    setIsLoading(true);
    Promise.resolve()
      .then(() => loadRef.current())
      .then((next) => {
        if (current !== generation.current) return;
        setData(next);
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (current !== generation.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (current === generation.current) setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: the caller's deps are the point
  }, deps);

  return { data, isLoading, error, reload };
};

export default useLoader;

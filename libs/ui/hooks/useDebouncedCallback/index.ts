import { useEffect, useMemo, useRef } from 'react';

export interface DebouncedCallback<Args extends unknown[]> {
  (...args: Args): void;
  /** Drop a call still waiting — before applying a final value directly. */
  cancel: () => void;
}

/**
 * `callback`, run only once calls have stopped for `delayMs` — a filter that follows typing
 * without redrawing (or asking the registry) on every key.
 *
 * The latest `callback` is always the one that runs, and a call still waiting when the
 * component unmounts is dropped.
 *
 * @example
 * const liveFilter = useDebouncedCallback(changeFilter, 150);
 * prompt.ask('Filter:', submit, { onChange: liveFilter });
 */
export const useDebouncedCallback = <Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): DebouncedCallback<Args> => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const debounced = useMemo(() => {
    const cancel = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = undefined;
    };
    return Object.assign(
      (...args: Args) => {
        cancel();
        timer.current = setTimeout(() => {
          timer.current = undefined;
          callbackRef.current(...args);
        }, delayMs);
      },
      { cancel },
    );
  }, [delayMs]);

  useEffect(() => debounced.cancel, [debounced]);

  return debounced;
};

export default useDebouncedCallback;

import { useCallback, useState } from 'react';

import type { IsOpen } from './lines';

/**
 * Which folds (a job's runs, a day of them) the person opened or closed — anything untouched is
 * as its line says by default. Kept for as long as the view is open.
 */
export const useFolds = () => {
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOpen: IsOpen = useCallback((key, byDefault) => chosen.get(key) ?? byDefault, [chosen]);
  /** Flip one fold; `current` is how it is drawn now. */
  const toggle = (key: string, current: boolean) =>
    setChosen((was) => new Map(was).set(key, !current));
  /** Open or close every one of `keys` at once. */
  const setAll = (keys: readonly string[], open: boolean) =>
    setChosen((was) => {
      const next = new Map(was);
      for (const key of keys) next.set(key, open);
      return next;
    });
  return { isOpen, toggle, setAll };
};

export default useFolds;

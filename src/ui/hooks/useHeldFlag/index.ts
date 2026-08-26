import { useEffect, useRef, useState } from 'react';

/**
 * A flag that stays on long enough to be read.
 *
 * `busy` is true for as long as a write takes, which for most operations is a
 * few tens of milliseconds — long enough to redraw the screen twice and not long
 * enough for anyone to see what changed. This holds the flag up for `holdMs`
 * from the moment it turned on, so a fast write still leaves a line on screen
 * for a beat and a slow one simply keeps it up until it finishes.
 *
 * The hold is deliberately not a delay before showing: a line that appears 300ms
 * into every action means the actions that need it least are the ones that flash.
 *
 * @example
 * const showBusy = useHeldFlag(busy, theme.timings.working);
 */
export const useHeldFlag = (active: boolean, holdMs: number): boolean => {
  const [held, setHeld] = useState(active);
  /** When the flag last turned on, which is what the hold is measured from. */
  const since = useRef(0);

  useEffect(() => {
    if (active) {
      since.current = Date.now();
      setHeld(true);
      return;
    }
    if (!held) return;
    const left = holdMs - (Date.now() - since.current);
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(timer);
  }, [active, held, holdMs]);

  return held;
};

export default useHeldFlag;

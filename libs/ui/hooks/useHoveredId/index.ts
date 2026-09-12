import { useCallback, useState } from 'react';

/**
 * Which of several elements the pointer is over.
 *
 * The subtlety is leaving, not entering. Elements report their own hover as a
 * bare boolean, so `false` arrives from the one being left *and* from every one
 * that was never hovered — and moving right to left across a row delivers the
 * leaver's `false` after the newcomer's `true`. Clearing on any `false` throws
 * away the id that was just set, which is a hint that blinks and vanishes.
 *
 * So a `false` only clears the id it names. Anything else is ignored.
 *
 * @example
 * const [hovered, reportHover] = useHoveredId<'speed' | 'wheel'>();
 * <ActionButton onHover={(over) => reportHover('speed', over)} />
 */
export const useHoveredId = <T>(): [T | null, (id: T, isHovered: boolean) => void] => {
  const [hovered, setHovered] = useState<T | null>(null);

  //? Stable, so an element can hold it in a ref and report only on a real
  //? transition rather than on every render.
  const report = useCallback((id: T, isHovered: boolean) => {
    setHovered((current) => (isHovered ? id : current === id ? null : current));
  }, []);

  return [hovered, report];
};

export default useHoveredId;

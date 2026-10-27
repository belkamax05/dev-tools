import { useEffect, useRef } from 'react';

/**
 * Each page's scroll, kept while the view is open: `keep` before leaving a page, and coming back
 * to it puts it where it was left.
 */
export const useKeptOffsets = (
  pageKey: string,
  nav: { offset: number; setOffset: (offset: number) => void },
) => {
  const offsets = useRef(new Map<string, number>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a page's scroll comes back with it
  useEffect(() => {
    const saved = offsets.current.get(pageKey);
    if (saved) nav.setOffset(saved);
  }, [pageKey]);
  return () => {
    offsets.current.set(pageKey, nav.offset);
  };
};

export default useKeptOffsets;

import { useEffect, useRef, useState } from 'react';

/** End of a window, exclusive, filling its physical line budget. */
export const windowEnd = (heights: readonly number[], start: number, budget: number): number => {
  let end = start;
  let used = 0;
  while (end < heights.length) {
    const height = heights[end] ?? 1;
    if (end > start && used + height > budget) break;
    used += height;
    end += 1;
  }
  return end;
};

/** Earliest start that fits the last row, used to avoid empty space at the end. */
export const windowStart = (heights: readonly number[], end: number, budget: number): number => {
  let start = Math.max(0, end - 1);
  let used = heights[start] ?? 0;
  while (start > 0 && used + (heights[start - 1] ?? 1) <= budget) {
    used += heights[start - 1] ?? 1;
    start -= 1;
  }
  return start;
};

/** Keep the cursor visible while accounting for headers and cards of different heights. */
export const followSelection = (
  heights: readonly number[],
  budget: number,
  previous: number,
  selected: number,
): number => {
  if (heights.length === 0) return 0;
  const last = windowStart(heights, heights.length, budget);
  const start = Math.max(0, Math.min(previous, last));
  if (selected < start) return Math.max(0, selected);
  if (selected >= windowEnd(heights, start, budget)) {
    return windowStart(heights, Math.min(selected + 1, heights.length), budget);
  }
  return start;
};

/** A scrolling window sized in terminal lines; uniform one-line lists remain the default. */
export const useScrollWindow = (
  count: number,
  selected: number,
  size: number,
  rowHeights?: readonly number[],
): [number, React.Dispatch<React.SetStateAction<number>>] => {
  const [start, setStart] = useState(0);
  const heights = rowHeights ?? Array.from({ length: count }, () => 1);
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  const heightKey = heights.join(',');

  useEffect(() => {
    setStart((previous) => followSelection(heightsRef.current, size, previous, selected));
  }, [selected, size, heightKey]);

  return [start, setStart];
};

export default useScrollWindow;

import { type DOMElement, measureElement } from 'ink';
import { type RefObject, useEffect, useRef } from 'react';

import { onMouseEventCapture } from '../../terminal/mouse';
import useClickable from '../useClickable';

interface ScrollbarOptions {
  thumbTop: number;
  thumbSize: number;
  rows: number;
  maxOffset: number;
  onChange: (offset: number) => void;
  isActive: boolean;
}

/** Capture a scrollbar drag until release, even outside its track, without clicking controls underneath. */
export const useScrollbarDrag = (
  track: RefObject<DOMElement | null>,
  options: ScrollbarOptions,
) => {
  const current = useRef(options);
  current.current = options;
  useClickable(track, {
    isActive: options.isActive && options.maxOffset > 0,
    pointer: 'ns-resize',
  });
  useEffect(() => {
    if (!options.isActive) return;
    let grab: number | undefined;
    return onMouseEventCapture((event) => {
      if (
        grab !== undefined &&
        (event.type === 'release' || (event.type === 'move' && event.button === 'none'))
      ) {
        grab = undefined;
        return true;
      }
      const node = track.current;
      const { maxOffset, rows, thumbSize, thumbTop, onChange } = current.current;
      if (!node || maxOffset <= 0) {
        grab = undefined;
        return false;
      }
      const bounds = measureElement(node);
      const row = event.row - 1 - bounds.y;
      if (event.type === 'press' && event.button === 'left') {
        const column = event.column - 1;
        if (column < bounds.x || column >= bounds.x + bounds.width || row < 0 || row >= rows)
          return false;
        grab =
          row >= thumbTop && row < thumbTop + thumbSize
            ? row - thumbTop
            : Math.floor(thumbSize / 2);
      } else if (grab === undefined) return false;
      if (event.type === 'press' || (event.type === 'move' && event.button === 'left')) {
        const next = Math.round(((row - grab!) / Math.max(1, rows - thumbSize)) * maxOffset);
        onChange(Math.max(0, Math.min(maxOffset, next)));
      }
      return true;
    });
  }, [track, options.isActive]);
};

export default useScrollbarDrag;

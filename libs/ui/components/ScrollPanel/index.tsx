import { type DOMElement, measureElement, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '../Box';
import useClickable from '../../hooks/useClickable';
import Scrollbar from '../Scrollbar';
import { onFrame } from '../../terminal/frames';

export interface ScrollPanelProps {
  children: ReactNode;
  isActive: boolean;
  /** Allow independent mouse scrolling when another pane owns the keyboard. */
  isMouseActive?: boolean;
  /** Preview mode leaves Space and letter keys to the surrounding app's actions. */
  keyboardMode?: 'reading' | 'preview';
  /** Move to this content row when the active section or hunk changes. */
  scrollTo?: number;
  /** Controlled position for linked previews; each panel clamps it to its own content. */
  scrollOffset?: number;
  onScroll?: (offset: number) => void;
}

/** Scroll complete content with wheel, page keys and a draggable scrollbar. */
export const ScrollPanel = ({
  children,
  isActive,
  isMouseActive = isActive,
  keyboardMode = 'reading',
  scrollTo = 0,
  scrollOffset,
  onScroll,
}: ScrollPanelProps) => {
  const viewport = useRef<DOMElement>(null);
  const content = useRef<DOMElement>(null);
  const [size, setSize] = useState({ rows: 1, total: 1 });
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(Math.max(0, scrollTo)), [scrollTo]);
  const maxOffset = Math.max(0, size.total - size.rows);
  const top = Math.min(scrollOffset ?? offset, maxOffset);
  const changeOffset = (next: number) => {
    const bounded = Math.max(0, Math.min(maxOffset, next));
    setOffset(bounded);
    onScroll?.(bounded);
  };

  // Measure after wrapping and layout, also when async plans or terminal resizing change it.
  const measure = useCallback(() => {
    if (!viewport.current || !content.current) return;
    const rows = Math.max(1, Math.floor(measureElement(viewport.current).height));
    const total = Math.max(1, Math.ceil(measureElement(content.current).height));
    setSize((was) => (was.rows === rows && was.total === total ? was : { rows, total }));
    setOffset((was) => Math.min(was, Math.max(0, total - rows)));
  }, []);
  useLayoutEffect(measure);
  // Timings load inside a child, so the scroll container may not itself re-render.
  useEffect(() => onFrame(measure), [measure]);

  const scrollBy = (delta: number) => changeOffset(top + delta);
  useClickable(viewport, {
    onWheel: (event) => scrollBy(event.wheel === 'up' ? -3 : 3),
    isActive: isMouseActive,
  });
  useInput(
    (input, key) => {
      if (key.pageUp || (key.ctrl && input === 'u')) scrollBy(-size.rows);
      else if (
        key.pageDown ||
        (keyboardMode === 'reading' && input === ' ') ||
        (key.ctrl && input === 'd')
      )
        scrollBy(size.rows);
      else if ((keyboardMode === 'reading' && input === 'k') || (key.shift && key.upArrow))
        scrollBy(-1);
      else if ((keyboardMode === 'reading' && input === 'j') || (key.shift && key.downArrow))
        scrollBy(1);
      else if ((keyboardMode === 'reading' && input === 'g') || key.home) changeOffset(0);
      else if ((keyboardMode === 'reading' && input === 'G') || key.end) changeOffset(maxOffset);
    },
    { isActive },
  );

  return (
    <Box flexDirection="row" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      <Box
        ref={viewport}
        minHeight={0}
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        overflow="hidden"
      >
        <Box
          ref={content}
          position="absolute"
          top={-top}
          width="100%"
          flexDirection="column"
          flexShrink={0}
        >
          {children}
        </Box>
      </Box>
      <Scrollbar
        offset={top}
        maxOffset={maxOffset}
        rows={size.rows}
        total={size.total}
        onChange={changeOffset}
        isActive={isMouseActive}
      />
    </Box>
  );
};

export default ScrollPanel;

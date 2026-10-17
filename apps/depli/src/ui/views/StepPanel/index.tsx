import { type DOMElement, measureElement, Text, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useScrollbarDrag from '@/dev-tools/ui/hooks/useScrollbarDrag';
import { onFrame } from '@/dev-tools/ui/terminal/frames';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** Scroll the complete step detail, including its buttons and wrapped parameter values. */
export const StepPanel = ({ children, isActive }: { children: ReactNode; isActive: boolean }) => {
  const colors = useColors();
  const viewport = useRef<DOMElement>(null);
  const track = useRef<DOMElement>(null);
  const content = useRef<DOMElement>(null);
  const [size, setSize] = useState({ rows: 1, total: 1 });
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, size.total - size.rows);
  const top = Math.min(offset, maxOffset);

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

  const scrollBy = (delta: number) =>
    setOffset((was) => Math.max(0, Math.min(maxOffset, was + delta)));
  useClickable(viewport, {
    onWheel: (event) => scrollBy(event.wheel === 'up' ? -3 : 3),
    isActive,
  });
  useInput(
    (input, key) => {
      if (key.pageUp || (key.ctrl && input === 'u')) scrollBy(-size.rows);
      else if (key.pageDown || input === ' ' || (key.ctrl && input === 'd')) scrollBy(size.rows);
      else if (input === 'k' || (key.shift && key.upArrow)) scrollBy(-1);
      else if (input === 'j' || (key.shift && key.downArrow)) scrollBy(1);
      else if (input === 'g' || key.home) setOffset(0);
      else if (input === 'G' || key.end) setOffset(maxOffset);
    },
    { isActive },
  );

  const thumb = Math.max(1, Math.round((size.rows * size.rows) / size.total));
  const thumbTop = Math.round((top / Math.max(1, maxOffset)) * (size.rows - thumb));
  useScrollbarDrag(track, {
    thumbTop,
    thumbSize: thumb,
    rows: size.rows,
    maxOffset,
    onChange: setOffset,
    isActive,
  });
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
      <Box ref={track} width={1} flexShrink={0} flexDirection="column">
        {maxOffset > 0 &&
          Array.from({ length: size.rows }, (_, row) => (
            <Text
              key={row}
              color={row >= thumbTop && row < thumbTop + thumb ? colors.accent : colors.muted}
            >
              {row >= thumbTop && row < thumbTop + thumb ? '┃' : '│'}
            </Text>
          ))}
      </Box>
    </Box>
  );
};

export default StepPanel;

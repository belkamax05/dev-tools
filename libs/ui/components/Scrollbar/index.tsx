import { type DOMElement, Text } from 'ink';
import { useRef } from 'react';

import useScrollbarDrag from '../../hooks/useScrollbarDrag';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface ScrollbarProps {
  offset: number;
  maxOffset: number;
  rows: number;
  total: number;
  onChange: (offset: number) => void;
  isActive: boolean;
}

/** A shared scrollbar with track clicks and captured dragging, including outside its track. */
const Scrollbar = ({ offset, maxOffset, rows, total, onChange, isActive }: ScrollbarProps) => {
  const colors = useColors();
  const track = useRef<DOMElement>(null);
  const thumb = Math.min(rows, Math.max(1, Math.round((rows * rows) / Math.max(1, total))));
  const thumbTop = Math.round((offset / Math.max(1, maxOffset)) * (rows - thumb));
  useScrollbarDrag(track, { thumbTop, thumbSize: thumb, rows, maxOffset, onChange, isActive });
  return (
    <Box ref={track} width={1} flexShrink={0} flexDirection="column">
      {maxOffset > 0 &&
        Array.from({ length: rows }, (_, row) => (
          <Text
            key={row}
            color={row >= thumbTop && row < thumbTop + thumb ? colors.accent : colors.muted}
          >
            {row >= thumbTop && row < thumbTop + thumb ? '┃' : '│'}
          </Text>
        ))}
    </Box>
  );
};

export default Scrollbar;

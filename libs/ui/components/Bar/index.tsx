import type { BoxProps, DOMElement } from 'ink';
import type { ReactNode, Ref } from 'react';

import useViewport from '../../hooks/useViewport';
import Box from '../Box';

export interface BarProps extends Omit<BoxProps, 'borderStyle' | 'borderColor'> {
  /** Accent for the frame. The strip's own text keeps its colour either way. */
  color?: string;
  /** The frame drawn when the terminal can afford the two rows it costs. */
  frame?: 'single' | 'round';
  /** Forwarded to the underlying box, so a strip can still be made clickable. */
  ref?: Ref<DOMElement>;
  children?: ReactNode;
}

/**
 * A strip of status text — a summary line, a hint line, the footer.
 *
 * The frame around one row of text is the worst deal in a terminal layout: two
 * rows spent restating what the row already says. On a terminal that cannot
 * afford it the frame goes and the strip becomes its text (see
 * `theme/display.barBorders`).
 *
 * Margins are deliberately not shed with it. A blank row separates one strip
 * from the next for one row instead of two, so when space is short it is the
 * better of the two to keep — which is also why `theme/chrome` prices an
 * unframed strip at 2 rows rather than 1.
 */
export const Bar = ({ color, frame = 'single', children, ...box }: BarProps) => {
  const framed = useViewport().shows.barBorders !== false;

  return (
    <Box
      paddingX={1}
      {...box}
      borderStyle={framed ? frame : undefined}
      borderColor={framed ? color : undefined}
    >
      {children}
    </Box>
  );
};

export default Bar;

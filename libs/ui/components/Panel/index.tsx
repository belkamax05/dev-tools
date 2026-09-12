import { type DOMElement, Text } from 'ink';
import type { ReactNode, Ref } from 'react';

import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface PanelProps {
  /** The bold line at the top of the frame. Omit for an unlabelled card. */
  title?: string;
  /**
   * A short value pinned to the right of the title row — a count, a state.
   *
   * On the title row rather than in the body because it is what the panel is
   * *about*: a reader scanning a dashboard for the one panel that has something
   * to say reads the title row and nothing else.
   */
  badge?: string;
  /** Colour for the badge. Defaults to the theme's muted. */
  badgeColor?: string;
  /** Accent for the frame and title. Defaults to muted, or accent when focused. */
  color?: string;
  /** Draws the frame in the accent and the title bold — one panel at a time. */
  isFocused?: boolean;
  width?: number | string;
  /** Take whatever vertical space is going. Off by default, so cards stay compact. */
  grow?: boolean;
  ref?: Ref<DOMElement>;
  children?: ReactNode;
}

/**
 * A titled card — the unit a dashboard is built out of.
 *
 * The border stays at every size, unlike `Bar`'s. A bar is one row of text that
 * a frame merely decorates, so the frame is the first thing worth shedding; a
 * panel sits next to other panels, and the border is the only thing saying where
 * one ends and the next begins. `theme/chrome.panelFrame` prices it accordingly
 * — a flat 6 rows, with no cheaper unframed variant to fall back to.
 */
export const Panel = ({
  title,
  badge,
  badgeColor,
  color,
  isFocused = false,
  width,
  grow = false,
  ref,
  children,
}: PanelProps) => {
  const colors = useColors();
  const frameColor = color ?? (isFocused ? colors.accent : colors.muted);

  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      flexGrow={grow ? 1 : 0}
      flexShrink={1}
      borderStyle="round"
      borderColor={frameColor}
      paddingX={1}
      overflow="hidden"
    >
      {title !== undefined && (
        <Box justifyContent="space-between" flexShrink={0}>
          <Text bold color={frameColor} wrap="truncate">
            {title}
          </Text>
          {badge !== undefined && (
            <Text color={badgeColor ?? colors.muted} wrap="truncate">
              {' '}
              {badge}
            </Text>
          )}
        </Box>
      )}
      {children}
    </Box>
  );
};

export default Panel;

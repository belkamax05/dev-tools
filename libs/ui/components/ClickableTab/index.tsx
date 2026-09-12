import { type DOMElement, Text } from 'ink';
import { useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import useViewport from '../../hooks/useViewport';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface ClickableTabProps {
  label: string;
  /** The label with the name taken off — what a shrunken tab is reduced to. */
  icon: string;
  index: number;
  isActive: boolean;
  /**
   * Whether the whole strip is in compact mode — set on every tab, not just the
   * closed ones.
   *
   * A closed tab in compact mode is reduced to its number and icon; the open one
   * keeps its name, because a strip of symbols does not say where you are and
   * the one name worth the columns is the name of what you are looking at.
   *
   * No tab flexes in this mode, open one included. Letting the open tab absorb
   * the slack instead centres its label in the middle of the empty strip, which
   * reads as a stray word rather than as a tab.
   */
  compact?: boolean;
  onSelect: () => void;
}

/**
 * One navigation tab, selectable with the mouse as well as the keyboard.
 *
 * Hover is drawn rather than relying on the pointer changing shape: only kitty
 * can do that (OSC 22), so on every other terminal a highlight is the only
 * feedback there is. `useClickable` still asks for the hand pointer where it
 * works, so kitty users get both.
 */
export const ClickableTab = ({
  label,
  icon,
  index,
  isActive,
  compact = false,
  onSelect,
}: ClickableTabProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onSelect });
  //? The bar sheds its borders on a short terminal along with every other frame.
  //? The open tab is then down to its bold accent label and the fact that it is
  //? the one still spelling its name out, which is enough — the border was never
  //? the only thing saying which tab is on.
  const framed = useViewport().shows.barBorders !== false;

  const borderColor = isActive ? colors.accent : isHovered ? colors.text : colors.muted;

  return (
    <Box
      ref={ref}
      flexGrow={compact ? 0 : 1}
      flexShrink={0}
      paddingX={compact ? 1 : 0}
      justifyContent="center"
      //? The page colour, on the open tab as much as on the rest: a tab filled
      //? with the accent is a block of colour the size of a word, which reads as
      //? the loudest thing on screen when it is only saying "you are here". The
      //? accent does that job on the border and the label instead.
      //?
      //? Stated rather than left undefined so it is the same prop either way —
      //? Ink rebuilds a box that gains or loses a background.
      backgroundColor={colors.page}
      borderStyle={framed ? 'single' : undefined}
      borderColor={framed ? borderColor : undefined}
    >
      <Text
        bold={isActive || isHovered}
        color={isActive ? colors.accent : isHovered ? colors.text : colors.muted}
      >
        [{index + 1}] {compact && !isActive ? icon : label}
      </Text>
    </Box>
  );
};

export default ClickableTab;

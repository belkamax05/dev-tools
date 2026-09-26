import { type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import useClickable from '../../hooks/useClickable';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface LinkRowProps {
  label: string;
  value: string;
  /** Colour of the value when the row is not highlighted. */
  color?: string;
  /** Highlighted as the keyboard's current position. */
  isFocused?: boolean;
  /** Undefined for a row that is information only — drawn plain, not clickable. */
  onOpen?: () => void;
}

/**
 * A "label  value" line in a detail pane that opens something — a file, a
 * folder — when clicked or when the keyboard lands on it and Enter is pressed.
 *
 * Highlighted the same way for the pointer and the keyboard, so there is one
 * look for "this is what Enter or a click would open". A row with no `onOpen`
 * is drawn plain and ignores the pointer: something that looks clickable and is
 * not is worse than something that is not styled at all.
 */
export const LinkRow = ({ label, value, color, isFocused = false, onOpen }: LinkRowProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: () => onOpen?.(), isActive: Boolean(onOpen) });
  const lit = Boolean(onOpen) && (isHovered || isFocused);

  return (
    <Box ref={ref} backgroundColor={lit ? colors.accent : undefined}>
      {/* A fixed-width box, not padEnd: Ink trims a Text's trailing spaces
          when the row has a background, which shifted the value a column */}
      <Box width={8} flexShrink={0}>
        <Text color={lit ? colors.accentText : colors.muted}>{label}</Text>
      </Box>
      <Text
        color={lit ? colors.accentText : (color ?? colors.text)}
        underline={Boolean(onOpen) && !lit}
        wrap="truncate"
      >
        {value}
      </Text>
    </Box>
  );
};

export default LinkRow;

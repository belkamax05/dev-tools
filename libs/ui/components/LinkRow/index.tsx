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
  /** Cells the label column takes. 8 fits the one-word labels of a detail pane. */
  labelWidth?: number;
}

/**
 * A "label  value" line in a detail pane that opens something — a file, a
 * folder — when clicked or when the keyboard lands on it and Enter is pressed.
 *
 * Highlighted the same way for the pointer and the keyboard, so there is one
 * look for "this is what Enter or a click would open". Only the value is the
 * link — it alone is hit-tested and lit; the label is a caption. A row with no
 * `onOpen` is drawn plain and ignores the pointer: something that looks
 * clickable and is not is worse than something that is not styled at all.
 */
export const LinkRow = ({
  label,
  value,
  color,
  isFocused = false,
  onOpen,
  labelWidth = 8,
}: LinkRowProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: () => onOpen?.(), isActive: Boolean(onOpen) });
  const lit = Boolean(onOpen) && (isHovered || isFocused);

  return (
    <Box>
      <Box width={labelWidth} flexShrink={0}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Box ref={ref} flexShrink={1} backgroundColor={lit ? colors.accent : undefined}>
        <Text
          color={lit ? colors.accentText : (color ?? colors.text)}
          underline={Boolean(onOpen) && !lit}
          wrap="truncate"
        >
          {value}
        </Text>
      </Box>
    </Box>
  );
};

export default LinkRow;

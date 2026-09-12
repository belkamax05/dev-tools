import { Text } from 'ink';

import { useColors, useTuiTheme } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface TerminalTooSmallProps {
  columns: number;
  rows: number;
}

/**
 * What an app draws when it cannot draw itself.
 *
 * Below `theme.sizes.app.minHeight` every sheddable element is already shed and
 * the bare content still does not fit, so there is no smaller layout left to
 * fall back to. Ink does not clip what overflows — Yoga compresses it, and a
 * bordered box ends up with its text written across its own border. A terminal
 * that says what it needs beats a frame that looks broken for no stated reason.
 *
 * Deliberately plain: no borders, no flex, nothing that needs room to be right.
 */
export const TerminalTooSmall = ({ columns, rows }: TerminalTooSmallProps) => {
  const colors = useColors();
  const { app } = useTuiTheme().sizes;
  const shortRows = rows < app.minHeight;
  const narrow = columns < app.minWidth;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={colors.warn}>
        Terminal too small
      </Text>
      <Text color={colors.muted}>
        now{'  '}
        <Text color={narrow ? colors.error : colors.text}>{columns}</Text>
        <Text color={colors.muted}> × </Text>
        <Text color={shortRows ? colors.error : colors.text}>{rows}</Text>
      </Text>
      <Text color={colors.muted}>
        need {app.minWidth} × {app.minHeight}
      </Text>
    </Box>
  );
};

export default TerminalTooSmall;

import { Text } from 'ink';
import type { ReactNode } from 'react';

import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface AppHeaderProps {
  /** What the app is, on the left of the accent bar. */
  title: string;
  /** What it is pointed at right now — a port, a repository, a file. */
  detail?: string;
  /**
   * A second line under the bar, for context the title cannot carry.
   *
   * Truncated, never wrapped: `theme/chrome` prices the header at a fixed number
   * of rows and every view's list length is budgeted against it, so a note that
   * took two rows on a narrow terminal would make the app one row taller than
   * the budget says — which does not clip, it scrolls, and the next frame draws
   * one strip on top of another.
   */
  note?: ReactNode;
}

/**
 * The bar across the top: what this is, and what it is looking at.
 *
 * Filled with the accent rather than framed, because it is the one element that
 * never competes with anything for attention — it is read once on the way in and
 * then ignored, which is exactly what a solid block of colour earns.
 */
export const AppHeader = ({ title, detail, note }: AppHeaderProps) => {
  const colors = useColors();

  return (
    <Box flexDirection="column" width="100%">
      <Box backgroundColor={colors.accent} paddingX={2} justifyContent="space-between">
        <Text bold color={colors.accentText} wrap="truncate">
          {title}
        </Text>
        {detail !== undefined && (
          <Text bold color={colors.accentText} wrap="truncate-start">
            {detail}
          </Text>
        )}
      </Box>
      {note !== undefined && (
        <Box paddingX={2} justifyContent="flex-end">
          {typeof note === 'string' ? (
            <Text color={colors.muted} wrap="truncate-start">
              {note}
            </Text>
          ) : (
            note
          )}
        </Box>
      )}
    </Box>
  );
};

export default AppHeader;

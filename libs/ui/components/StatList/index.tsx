import { Text } from 'ink';

import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface Stat {
  label: string;
  /** Rendered as written — format numbers and dates before they get here. */
  value: string;
  /** Colour for the value. Defaults to the theme's body text. */
  color?: string;
  /** Trailing note, dimmed — a unit, a source, a caveat. */
  hint?: string;
  /** Draws the value bold, for the one row the panel exists to show. */
  emphasis?: boolean;
}

export interface StatListProps {
  stats: Stat[];
  /**
   * Cells reserved for the labels, so the values line up into a column.
   *
   * Measured from the longest label by default. Worth setting by hand when two
   * panels sit side by side and their columns should agree — a dashboard whose
   * values are at four different offsets reads as four unrelated boxes.
   */
  labelWidth?: number;
}

/**
 * Label-and-value rows: what a dashboard card is made of.
 *
 * Padded into a column rather than spaced with flex, because Yoga distributes
 * slack per row and a label one character longer than its neighbour pushes only
 * its own value across. Aligning the values is the whole point — the eye reads
 * down the column, and a column that wanders is a list.
 */
export const StatList = ({ stats, labelWidth }: StatListProps) => {
  const colors = useColors();
  const width =
    labelWidth ?? stats.reduce((widest, stat) => Math.max(widest, stat.label.length), 0);

  return (
    <Box flexDirection="column">
      {stats.map((stat) => (
        <Box key={stat.label}>
          <Text color={colors.muted}>{stat.label.padEnd(width)} </Text>
          <Text color={stat.color ?? colors.text} bold={stat.emphasis} wrap="truncate">
            {stat.value}
          </Text>
          {stat.hint !== undefined && (
            <Text color={colors.muted} wrap="truncate">
              {' '}
              {stat.hint}
            </Text>
          )}
        </Box>
      ))}
    </Box>
  );
};

export default StatList;

import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { FileDiff } from '../../../core/hunks';

export interface DiffLinesProps {
  diff: FileDiff;
  /** The hunk the keyboard is on — drawn marked, and scrolled to. */
  activeHunk?: number;
  rows: number;
}

/**
 * A file's diff, coloured, starting at the active hunk so it is on screen
 * whatever came before it. The hunk header of the active hunk is marked, and
 * the lines are cut to the rows the pane has.
 */
export const DiffLines = ({ diff, activeHunk = 0, rows }: DiffLinesProps) => {
  const colors = useColors();
  if (diff.binary) return <Text color={colors.muted}>Binary file — no text diff.</Text>;
  if (!diff.hunks.length) return <Text color={colors.muted}>No changes to show.</Text>;

  const lines = diff.hunks
    .slice(activeHunk)
    .flatMap((hunk, offset) =>
      hunk.lines.map((line, index) => ({ line, header: index === 0, active: offset === 0 })),
    );

  return (
    <Box flexDirection="column">
      {lines.slice(0, Math.max(1, rows)).map(({ line, header, active }, index) => (
        <Text
          key={index}
          wrap="truncate"
          bold={header && active}
          color={
            header
              ? active
                ? colors.accent
                : colors.muted
              : line.startsWith('+')
                ? colors.ok
                : line.startsWith('-')
                  ? colors.error
                  : colors.text
          }
        >
          {header ? `${active ? '▶ ' : '  '}${line}` : line || ' '}
        </Text>
      ))}
    </Box>
  );
};

export default DiffLines;

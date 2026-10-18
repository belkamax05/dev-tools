import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { FileDiff } from '../../../core/hunks';

export interface DiffLinesProps {
  diff: FileDiff;
  /** The hunk the keyboard is on — drawn marked, and scrolled to. */
  activeHunk?: number;
}

/**
 * A complete file diff, with its active hunk marked. The shared ScrollPanel
 * owns clipping and scrolling so large hunks remain readable to their end.
 */
export const DiffLines = ({ diff, activeHunk = 0 }: DiffLinesProps) => {
  const colors = useColors();
  if (diff.binary) return <Text color={colors.muted}>Binary file — no text diff.</Text>;
  if (!diff.hunks.length) return <Text color={colors.muted}>No changes to show.</Text>;

  const lines = diff.hunks.flatMap((hunk, offset) =>
    hunk.lines.map((line, index) => ({ line, header: index === 0, active: offset === activeHunk })),
  );

  return (
    <Box flexDirection="column">
      {lines.map(({ line, header, active }, index) => (
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

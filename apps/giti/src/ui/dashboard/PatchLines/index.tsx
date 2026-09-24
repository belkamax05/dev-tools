import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/**
 * Any patch text — a commit, a stash, a branch comparison, several files at
 * once — coloured line by line and cut to the rows there are. `DiffLines` is
 * for one file walked by hunk; this is for reading.
 */
export const PatchLines = ({ text, rows }: { text: string; rows: number }) => {
  const colors = useColors();
  if (!text.trim()) return <Text color={colors.muted}>No changes.</Text>;
  return (
    <Box flexDirection="column">
      {text
        .replace(/\n$/, '')
        .split('\n')
        .slice(0, Math.max(1, rows))
        .map((line, index) => (
          <Text
            key={index}
            wrap="truncate"
            bold={line.startsWith('diff --git')}
            color={
              line.startsWith('diff --git')
                ? colors.text
                : line.startsWith('@@')
                  ? colors.accent
                  : line.startsWith('+') && !line.startsWith('+++')
                    ? colors.ok
                    : line.startsWith('-') && !line.startsWith('---')
                      ? colors.error
                      : colors.muted
            }
          >
            {line || ' '}
          </Text>
        ))}
    </Box>
  );
};

export default PatchLines;

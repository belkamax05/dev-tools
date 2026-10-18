import { Text } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** The scroll keys, for a view listing them in its hints. */
export const PREVIEW_SCROLL_HINT = {
  key: 'PgUp/PgDn · ⇧↑/↓ · wheel',
  label: 'scroll preview',
} as const;

export interface PreviewLinesProps {
  text: string;
  /** Colour `+`/`-`/`@@` lines as a diff rather than drawing the text plain. */
  diffing?: boolean;
  /** False while a prompt owns the keyboard. The wheel works regardless. */
  isActive?: boolean;
}

/**
 * A file, or its diff, in the detail pane — the rest of the pane, scrolling on its own.
 *
 * It sits beside a list that owns ↑/↓, so it scrolls on keys the list does not
 * use: PgUp/PgDn by a page, Shift+↑/↓ by a line, the wheel over it, and its
 * scrollbar. A new text starts at the top again — the next file is read from its
 * beginning.
 */
export const PreviewLines = ({ text, diffing = false, isActive = true }: PreviewLinesProps) => {
  const colors = useColors();
  const lines = text.replace(/\n$/, '').split('\n');
  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0} marginTop={1}>
      <ScrollPanel key={text} keyboardMode="preview" isActive={isActive} isMouseActive>
        {lines.map((line, index) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, and repeat
            key={index}
            wrap="truncate"
            color={
              !diffing
                ? colors.text
                : line.startsWith('+')
                  ? colors.ok
                  : line.startsWith('-')
                    ? colors.error
                    : line.startsWith('@@')
                      ? colors.accent
                      : colors.muted
            }
          >
            {line || ' '}
          </Text>
        ))}
      </ScrollPanel>
    </Box>
  );
};

export default PreviewLines;

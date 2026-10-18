import { Text } from 'ink';

import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import terminalText from '@/dev-tools/ui/utils/terminalText';

/** The scroll keys, for a view listing them in its hints. */
export const PATCH_SCROLL_HINT = { key: 'PgUp/PgDn · ⇧↑/↓ · wheel', label: 'scroll diff' } as const;

export interface PatchLinesProps {
  text: string;
  /** False while a prompt owns the keyboard. The wheel works regardless. */
  isActive?: boolean;
}

/**
 * Any patch text — a commit, a stash, a branch comparison, several files at
 * once — coloured line by line in a window that scrolls. `DiffLines` is for one
 * file walked by hunk; this is for reading.
 *
 * It sits beside a list that owns ↑/↓, so it scrolls on keys the list does not
 * use: PgUp/PgDn by a page, Shift+↑/↓ by a line, and the wheel over it. A new
 * text starts at the top again — the next commit is read from its beginning.
 */
export const PatchLines = ({ text, isActive = true }: PatchLinesProps) => {
  const colors = useColors();
  //? Tabs expanded: a raw one is wider on screen than Ink measures it, and breaks the frame
  const lines = text.replace(/\n$/, '').split('\n').map((line) => terminalText(line));
  if (!text.trim()) return <Text color={colors.muted}>No changes.</Text>;
  return (
    <ScrollPanel key={text} keyboardMode="preview" isActive={isActive}>
      {lines.map((line, index) => (
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
    </ScrollPanel>
  );
};

export default PatchLines;

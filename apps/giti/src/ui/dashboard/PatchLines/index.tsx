import { type DOMElement, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** Lines one wheel notch moves — the same step `PickList` scrolls by. */
const WHEEL_STEP = 3;

/** The scroll keys, for a view listing them in its hints. */
export const PATCH_SCROLL_HINT = { key: 'PgUp/PgDn', label: 'scroll diff' } as const;

export interface PatchLinesProps {
  text: string;
  /** Rows the pane has, the position line included. */
  rows: number;
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
export const PatchLines = ({ text, rows, isActive = true }: PatchLinesProps) => {
  const colors = useColors();
  const lines = text.replace(/\n$/, '').split('\n');
  //? One row goes to the position line, but only when there is something to scroll
  const scrolls = lines.length > rows;
  const page = Math.max(1, scrolls ? rows - 1 : rows);
  const last = Math.max(0, lines.length - page);
  const [start, setStart] = useState(0);

  useEffect(() => {
    setStart(0);
  }, [text]);

  const scrollBy = (step: number) => setStart((at) => Math.max(0, Math.min(last, at + step)));

  const ref = useRef<DOMElement>(null);
  useClickable(ref, {
    onWheel: (event) => scrollBy(event.wheel === 'down' ? WHEEL_STEP : -WHEEL_STEP),
  });

  useInput(
    (_input, key) => {
      if (key.pageDown) scrollBy(page - 1);
      else if (key.pageUp) scrollBy(-(page - 1));
      else if (key.shift && key.downArrow) scrollBy(1);
      else if (key.shift && key.upArrow) scrollBy(-1);
    },
    { isActive: isActive && scrolls },
  );

  if (!text.trim()) return <Text color={colors.muted}>No changes.</Text>;
  const at = Math.min(start, last);
  return (
    <Box ref={ref} flexDirection="column">
      {/* On top: a toolbar that wraps above the pane takes its rows from the bottom */}
      {scrolls && (
        <Text color={colors.muted} wrap="truncate">
          {`lines ${at + 1}–${Math.min(lines.length, at + page)} of ${lines.length} · PgUp/PgDn, Shift+↑/↓ or wheel`}
        </Text>
      )}
      {lines.slice(at, at + page).map((line, index) => (
        <Text
          key={at + index}
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

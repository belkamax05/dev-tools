import { type DOMElement, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** Lines one wheel notch moves — the same step `PickList` scrolls by. */
const WHEEL_STEP = 3;

/** The scroll keys, for a view listing them in its hints. */
export const PREVIEW_SCROLL_HINT = {
  key: 'PgUp/PgDn',
  label: 'scroll preview',
} as const;

export interface PreviewLinesProps {
  text: string;
  /** Rows the preview has, the position line included. */
  rows: number;
  /** Colour `+`/`-`/`@@` lines as a diff rather than drawing the text plain. */
  diffing?: boolean;
  /** False while a prompt owns the keyboard. The wheel works regardless. */
  isActive?: boolean;
}

/**
 * A file, or its diff, in the detail pane — in a window that scrolls.
 *
 * It sits beside a list that owns ↑/↓, so it scrolls on keys the list does not
 * use: PgUp/PgDn by a page, Shift+↑/↓ by a line, and the wheel over it. A new
 * text starts at the top again — the next file is read from its beginning.
 */
export const PreviewLines = ({
  text,
  rows,
  diffing = false,
  isActive = true,
}: PreviewLinesProps) => {
  const colors = useColors();
  const lines = text.replace(/\n$/, '').split('\n');
  //? One row goes to the position line, but only when there is something to scroll
  const scrolls = lines.length > rows;
  const page = Math.max(1, scrolls ? rows - 1 : rows);
  const last = Math.max(0, lines.length - page);
  const [start, setStart] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text is the trigger
  useEffect(() => {
    setStart(0);
  }, [text]);

  const scrollBy = (step: number) =>
    setStart((at) => Math.max(0, Math.min(last, at + step)));

  const ref = useRef<DOMElement>(null);
  useClickable(ref, {
    onWheel: (event) =>
      scrollBy(event.wheel === 'down' ? WHEEL_STEP : -WHEEL_STEP),
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

  const at = Math.min(start, last);
  return (
    <Box ref={ref} flexDirection="column" marginTop={1}>
      {scrolls && (
        <Text color={colors.muted} wrap="truncate">
          {`lines ${at + 1}–${Math.min(lines.length, at + page)} of ${lines.length} · PgUp/PgDn, Shift+↑/↓ or wheel`}
        </Text>
      )}
      {lines.slice(at, at + page).map((line, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional, and repeat
          key={at + index}
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
    </Box>
  );
};

export default PreviewLines;

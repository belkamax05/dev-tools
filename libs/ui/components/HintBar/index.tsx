import { type DOMElement, Text } from 'ink';
import { useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import useViewport from '../../hooks/useViewport';
import { useColors, useTuiTheme } from '../../providers/TuiThemeProvider';
import { barInnerWidth } from '../../theme';
import Box from '../Box';

export interface Hint {
  /** The key that fires it, written as it reads in brackets: "r", "Enter", "↑/↓". */
  key: string;
  /** What that key does, in a word or two: "rename", "set binding". */
  label: string;
  /**
   * Given, the hint is a button as well as a reminder, and clicking it does
   * exactly what its key does.
   *
   * Left off, it stays a reminder and is drawn gray. Two kinds of hint belong
   * there: a key no click can stand in for — the arrows, or a pair like [+/-]
   * where one button has no direction — and an action that is not available
   * right now.
   */
  onPress?: () => void;
}

/** What sits between two hints. Its length is part of the fit below. */
const SEPARATOR = ' · ';

/** What says hints were left out, and the cells kept back to draw it. */
const ELLIPSIS = ' …';

/** Cells one hint takes: its two brackets, the key, a space, and the label. */
export const hintWidth = (hint: Hint): number => 3 + hint.key.length + hint.label.length;

/**
 * The hints that fit `columns` cells, dropped from the right.
 *
 * A hint line as one string with `wrap="truncate"` cuts whatever runs past the
 * edge mid-word. Now that a hint is a button, half of one is worse than none: it
 * is still clickable, and it no longer reads as the thing it does. So they are
 * dropped whole, and the caller lists them in the order it is willing to lose
 * them.
 *
 * The row also has to stay exactly one line tall. `theme/chrome` prices the hint
 * strip at one row of hints plus one of status, and a strip that quietly becomes
 * two rows overruns every list budget measured against it.
 */
export const fitHints = (hints: Hint[], columns: number): { shown: Hint[]; dropped: number } => {
  let used = 0;
  let shown = 0;

  for (const hint of hints) {
    const width = hintWidth(hint) + (shown > 0 ? SEPARATOR.length : 0);
    //? The first hint is taken whether or not it fits. A row too narrow for even
    //? one is a row where the alternative is a lone "…", and a clipped
    //? `[Enter] appl` still names the key — the container is `overflow: hidden`,
    //? so what runs past the edge is cut rather than wrapped onto a second line.
    if (shown > 0 && used + width > columns) break;
    used += width;
    shown += 1;
  }

  //? Room for the "…" is taken from the last hint that fit rather than added on
  //? top, or the marker for the overrun would itself overrun. The one kept above
  //? is never given back for the same reason it was taken.
  while (shown > 1 && shown < hints.length && used + ELLIPSIS.length > columns) {
    shown -= 1;
    used -= hintWidth(hints[shown] as Hint) + SEPARATOR.length;
  }

  return { shown: hints.slice(0, shown), dropped: hints.length - shown };
};

const HintButton = ({ hint, isActive }: { hint: Hint; isActive: boolean }) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const pressable = hint.onPress !== undefined && isActive;
  const { isHovered } = useClickable(ref, {
    onClick: () => hint.onPress?.(),
    isActive: pressable,
  });
  const lit = pressable && isHovered;

  return (
    <Box ref={ref}>
      <Text bold color={lit ? colors.highlight : colors.text}>
        [{hint.key}]
      </Text>
      <Text color={lit ? colors.highlight : pressable ? colors.accent : colors.muted}>
        {' '}
        {hint.label}
      </Text>
    </Box>
  );
};

export interface HintBarProps {
  hints: Hint[];
  /**
   * False while the view cannot act on anything — a write in flight, say. The
   * whole row goes gray and stops responding, the same as the keys do.
   */
  isActive?: boolean;
  /** Cells the row has. Defaults to the width of a `Bar` on this terminal. */
  width?: number;
}

/**
 * The row of key hints under a view, with every hint that can be a button being
 * one.
 *
 * Accent is what a click does something to and gray is what it does not, which
 * is the one thing a hint line cannot say in words without doubling its length.
 * Hover is drawn rather than left to the pointer changing shape: only kitty can
 * do that, so a colour is the only feedback most terminals have.
 */
export const HintBar = ({ hints, isActive = true, width }: HintBarProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const framed = viewport.shows.barBorders !== false;
  const available = width ?? barInnerWidth(viewport.columns, framed, theme.sizes.app);
  const { shown, dropped } = fitHints(hints, available);

  return (
    <Box flexDirection="row" flexWrap="nowrap" overflow="hidden">
      {shown.map((hint, index) => (
        //? Each hint holds its width: shrinking one would wrap its text onto a
        //? second line, which is the one thing this row must never do.
        <Box key={`${hint.key}:${hint.label}`} flexShrink={0}>
          {index > 0 && <Text color={colors.muted}>{SEPARATOR}</Text>}
          <HintButton hint={hint} isActive={isActive} />
        </Box>
      ))}
      {dropped > 0 && (
        <Box flexShrink={0}>
          <Text color={colors.muted}>{ELLIPSIS}</Text>
        </Box>
      )}
    </Box>
  );
};

export default HintBar;

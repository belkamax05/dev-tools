import { type DOMElement, Text } from 'ink';
import { useEffect, useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import useHoveredId from '../../hooks/useHoveredId';
import { useTuiTheme } from '../../providers/TuiThemeProvider';
import type { ThemeDefinition } from '../../theme';
import Box from '../Box';

interface ThemeNameProps {
  theme: ThemeDefinition;
  isCurrent: boolean;
  onSelect: () => void;
  onHover: (isHovered: boolean) => void;
}

/**
 * One theme's name, drawn in that theme's own accent.
 *
 * The swatch *is* the label: a list of theme names in the current theme's colour
 * tells you nothing about what you are about to pick, and a terminal has no room
 * for a preview pane. Painting each name in its own accent makes the row the
 * preview — six words, six colours, and the one you want is the colour you want.
 */
const ThemeName = ({ theme, isCurrent, onSelect, onHover }: ThemeNameProps) => {
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onSelect });

  //? Held in a ref so the effect below turns on a real hover change alone —
  //? `onHover` is written inline by the caller, so as a dependency it would have
  //? every name re-reporting on every render. See `useHoveredId`.
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    onHoverRef.current(isHovered);
  }, [isHovered]);

  //? Brackets as well as colour and weight: which theme is on has to survive a
  //? terminal with no colour, and "the brighter one" is not a state you can read
  //? when every entry is a different hue by design.
  const label = isCurrent ? `[${theme.label}]` : ` ${theme.label} `;

  return (
    <Box ref={ref} marginRight={1}>
      <Text
        color={isHovered ? theme.colors.highlight : theme.colors.accent}
        bold={isCurrent || isHovered}
        //? The theme's own background under its own name, so a theme whose
        //? surface you would hate is visible before you pick it — but only when
        //? it is the current one, or the row becomes a strip of coloured blocks.
        backgroundColor={isCurrent ? theme.colors.surface : undefined}
      >
        {label}
      </Text>
    </Box>
  );
};

export interface ThemeSwitcherProps {
  /** Id of the palette in force. An unknown id simply marks nothing as current. */
  value: string;
  onSelect: (id: string) => void;
  /** Told which theme the pointer is over, for the caller's status line. */
  onHover?: (theme: ThemeDefinition | null) => void;
}

/**
 * Every palette on one row, pick one.
 *
 * A row rather than a dropdown because there are a handful of them and they are
 * one word each: a list that fits on the line it labels costs nothing to read
 * and one click to use, where a dropdown costs a keypress before it says
 * anything.
 */
export const ThemeSwitcher = ({ value, onSelect, onHover }: ThemeSwitcherProps) => {
  const themes = useTuiTheme().palettes;
  //? Tracked by id in one place rather than per name: each name only knows
  //? whether the pointer is on itself, and the last to say "no" would otherwise
  //? erase the one that just said "yes".
  const [hoveredId, reportHover] = useHoveredId<string>();

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const themesRef = useRef(themes);
  themesRef.current = themes;

  useEffect(() => {
    onHoverRef.current?.(themesRef.current.find((theme) => theme.id === hoveredId) ?? null);
  }, [hoveredId]);

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {themes.map((theme) => (
        <ThemeName
          key={theme.id}
          theme={theme}
          isCurrent={theme.id === value}
          onSelect={() => onSelect(theme.id)}
          onHover={(hovered) => reportHover(theme.id, hovered)}
        />
      ))}
    </Box>
  );
};

export default ThemeSwitcher;

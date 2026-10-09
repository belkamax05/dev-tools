import { type DOMElement, measureElement, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import useInputGrab from '../../hooks/useInputGrab';
import useViewport from '../../hooks/useViewport';
import { useColors } from '../../providers/TuiThemeProvider';
import { CUSTOM_THEME_ID, setPreviewTheme, type ThemeDefinition } from '../../theme';
import ActionButton from '../ActionButton';
import Box from '../Box';
import { listDetailPaneRows } from '../ListDetail';
import PaletteSwatch, { paletteSwatchRows } from '../PaletteSwatch';
import PickList, { moveInList, type PickItem } from '../PickList';

/** Rows a `ThemeCard` takes besides its swatch: name, and one of blurb. */
const CARD_TEXT_ROWS = 2;

/** Rows a `ThemeCard` takes at full size — for a caller budgeting the rest of a pane. */
export const themeCardRows = (): number => CARD_TEXT_ROWS + 1 + paletteSwatchRows();

export interface ThemeCardProps {
  theme: ThemeDefinition;
  /** Dimmed after the name — "in use", "Enter to choose from 12". */
  note?: string;
  /** Cells across, for the swatch. */
  width?: number;
  /** Without the swatch, for a pane with no room for it. */
  compact?: boolean;
}

/**
 * One theme at a glance: its name in its own accent, the blurb, and the swatch — the picture of
 * it where the terminal draws pixels. The Settings row and the dialog both show this, so the
 * theme in force and the one under the dialog's cursor look the same.
 */
export const ThemeCard = ({ theme, note, width = 40, compact = false }: ThemeCardProps) => {
  const colors = useColors();
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text bold color={theme.colors.accent} wrap="truncate">
        {theme.label}
        {note && <Text color={colors.muted}>{`  ${note}`}</Text>}
      </Text>
      <Text color={colors.muted} wrap="truncate">
        {theme.blurb}
      </Text>
      {!compact && (
        <Box marginTop={1}>
          <PaletteSwatch colors={theme.colors} width={width} />
        </Box>
      )}
    </Box>
  );
};

export interface ThemePickerProps {
  themes: readonly ThemeDefinition[];
  /** Id of the theme in force: where the cursor starts, and what Esc goes back to. */
  current: string;
  onPick: (id: string) => void;
  onCancel: () => void;
  /** Rows an app draws above its Settings view, passed on to the pane budget. */
  reservedChrome?: string[];
}

/** Rows that are neither card nor list rows: the list's frame (2), the buttons and the gap. */
const FRAME_ROWS = 4;

/** The swatch goes before the list is squeezed below this many rows. */
const MIN_LIST_ROWS = 5;

/**
 * Every palette, in a dialog: the Settings tab shows only the theme in force, and this is what
 * opens when you go to change it.
 *
 * The card on top is the theme under the cursor, and the whole app repaints as the cursor moves
 * (`setPreviewTheme`, the same live preview the editor uses). Enter or a click keeps it; Esc
 * leaves the theme as it was.
 *
 * It takes the keyboard while open (`useInputGrab`), so it can sit in a Settings detail pane
 * without the list beside it or the shell hearing its arrows.
 */
export const ThemePicker = ({
  themes,
  current,
  onPick,
  onCancel,
  reservedChrome,
}: ThemePickerProps) => {
  useInputGrab();
  const colors = useColors();
  const viewport = useViewport();
  const [cursor, setCursor] = useState(() =>
    Math.max(
      0,
      themes.findIndex((theme) => theme.id === current),
    ),
  );
  const theme = themes[cursor];

  useEffect(() => {
    setPreviewTheme(theme);
  }, [theme]);
  useEffect(() => () => setPreviewTheme(undefined), []);

  //? Width only: a pane stretches its content across, but not down — see `listDetailPaneRows`
  const rootRef = useRef<DOMElement>(null);
  const [width, setWidth] = useState(40);
  useEffect(() => {
    if (!rootRef.current) return;
    const measured = measureElement(rootRef.current).width;
    if (measured && measured !== width) setWidth(measured);
  });

  //? Every theme when they fit with the picture; the picture goes before the list scrolls short
  const space = listDetailPaneRows(viewport, reservedChrome) - FRAME_ROWS;
  const withSwatch = space - themeCardRows() >= Math.min(MIN_LIST_ROWS, themes.length);
  const listRows = Math.max(
    3,
    Math.min(themes.length, space - (withSwatch ? themeCardRows() : CARD_TEXT_ROWS)),
  );

  const items: PickItem<string>[] = themes.map((candidate) => ({
    id: candidate.id,
    label: candidate.id === CUSTOM_THEME_ID ? `★ ${candidate.label}` : candidate.label,
    hint: candidate.id === current ? 'in use' : undefined,
    hintColor: colors.accent,
    isCurrent: candidate.id === current,
    value: candidate.id,
  }));

  const pick = (index = cursor) => {
    const chosen = themes[index];
    if (chosen) onPick(chosen.id);
  };

  useInput((input, key) => {
    if (key.escape) onCancel();
    else if (key.return || input === ' ') pick();
    else if (key.upArrow) setCursor((at) => moveInList(items, 1, at, 'up'));
    else if (key.downArrow) setCursor((at) => moveInList(items, 1, at, 'down'));
  });

  return (
    <Box ref={rootRef} flexDirection="column" flexGrow={1} overflow="hidden">
      {theme && (
        <ThemeCard
          theme={theme}
          note={theme.id === current ? 'in use' : 'Enter to use'}
          width={width}
          compact={!withSwatch}
        />
      )}
      <PickList
        title={`Choose a theme · ${themes.length}`}
        items={items}
        selected={cursor}
        visibleRows={listRows}
        onSelect={setCursor}
        onActivate={pick}
      />
      <Box flexWrap="wrap" flexShrink={0}>
        <ActionButton hotkey="Enter" label="Use" color={colors.accent} onPress={() => pick()} />
        <ActionButton hotkey="Esc" label="Cancel" onPress={onCancel} />
      </Box>
    </Box>
  );
};

export default ThemePicker;

import { type DOMElement, measureElement, Text, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import useClickable from '../../hooks/useClickable';
import useInputGrab from '../../hooks/useInputGrab';
import usePrompt from '../../hooks/usePrompt';
import { useColors } from '../../providers/TuiThemeProvider';
import {
  COLOR_ROLES,
  type ColorRole,
  type CustomThemeDraft,
  cloneTheme,
  contrastRatio,
  customThemeFrom,
  normalizeColor,
  rotateHue,
  setPreviewTheme,
  shiftLightness,
  THEMES,
  themeById,
} from '../../theme';
import ActionButton from '../ActionButton';
import Box from '../Box';
import PaletteSwatch, { paletteSwatchRows } from '../PaletteSwatch';

type Row = { kind: 'base' } | { kind: 'background' } | { kind: 'role'; role: ColorRole; note: string };

const ROWS: readonly Row[] = [
  { kind: 'base' },
  { kind: 'background' },
  ...COLOR_ROLES.map(({ role, note }) => ({ kind: 'role' as const, role, note })),
];

/** Title, contrast, buttons and the key legend: what the editor draws besides its rows. */
const FIXED_ROWS = 4;
const MIN_ROWS_WITH_SWATCH = 6;
const LABEL_WIDTH = 12;
const HUE_STEP = 10;
const LIGHTNESS_STEP = 0.04;

interface EditorRowProps {
  isSelected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  children: React.ReactNode;
}

/** One line of the editor: the cursor marker, clickable — a click selects, a second activates. */
const EditorRow = ({ isSelected, onSelect, onActivate, children }: EditorRowProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: isSelected ? onActivate : onSelect });
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={isSelected ? colors.accent : isHovered ? colors.highlight : colors.muted}>
        {isSelected ? '› ' : '  '}
      </Text>
      {children}
    </Box>
  );
};

const ratioText = (ratio: number | undefined) => (ratio === undefined ? '?' : `${ratio.toFixed(1)}:1`);

export interface ThemeEditorProps {
  /** Where the editing starts: a copy of the theme in force. */
  initial: CustomThemeDraft;
  /** Save as the custom theme and switch to it. */
  onSave: (draft: CustomThemeDraft) => void;
  onCancel: () => void;
}

/**
 * Every colour of a theme, one row each, edited in place — with the whole app repainting in the
 * draft as it changes, so the preview is the real thing rather than a sample of it.
 *
 * It takes the keyboard for as long as it is open (`useInputGrab`), so it can sit inside any
 * view — a Settings detail pane — without that view, its list or the shell hearing a key typed
 * into a hex code. ↑/↓ pick a row; on a colour, Enter (or `#`) types a value, ←/→ turn the hue
 * and +/- lighten or darken; on "Based on", ←/→ start again from another stock theme; on
 * "Background", Enter chooses whether the theme paints its own. `s` saves and applies, `p`
 * turns the live preview off (for a draft so unreadable the editor is lost in it), Esc
 * abandons the edit.
 */
export const ThemeEditor = ({ initial, onSave, onCancel }: ThemeEditorProps) => {
  useInputGrab();
  const colors = useColors();
  const [draft, setDraft] = useState(initial);
  const [cursor, setCursor] = useState(2);
  const [live, setLive] = useState(true);
  //? The prompt lives inside the grab, so it has no app-level capture to report to
  const prompt = usePrompt(useCallback(() => {}, []));

  useEffect(() => {
    setPreviewTheme(live ? customThemeFrom(draft) : undefined);
  }, [draft, live]);
  useEffect(() => () => setPreviewTheme(undefined), []);

  //? Measured, so the rows scroll inside whatever pane this is put in rather than overflow it
  const rootRef = useRef<DOMElement>(null);
  const [pane, setPane] = useState({ height: 0, width: 40 });
  useEffect(() => {
    if (!rootRef.current) return;
    const { height, width } = measureElement(rootRef.current);
    if (height !== pane.height || width !== pane.width) setPane({ height, width });
  });
  const space = pane.height;

  const row = ROWS[cursor] as Row;
  const focus = row.kind === 'role' ? row.role : undefined;

  const setRole = (role: ColorRole, value: string | undefined) => {
    if (value) setDraft((was) => ({ ...was, colors: { ...was.colors, [role]: value } }));
  };
  const stepBase = (step: number) => {
    const at = THEMES.findIndex((theme) => theme.id === draft.basedOn);
    const next = THEMES[(at + step + THEMES.length) % THEMES.length];
    if (next) setDraft(cloneTheme(next));
  };
  const editHex = (role: ColorRole, typed = '') => {
    const before = draft.colors[role];
    prompt.ask(`${role} =`, (value) => setRole(role, normalizeColor(value) ?? before), {
      initial: typed || before,
      onChange: (value) => setRole(role, normalizeColor(value)),
      onCancel: () => setRole(role, before),
    });
  };
  const activate = (target: Row) => {
    if (target.kind === 'base') stepBase(1);
    else if (target.kind === 'background') setDraft((was) => ({ ...was, opaque: !was.opaque }));
    else editHex(target.role);
  };

  useInput(
    (input, key) => {
      if (key.escape) return onCancel();
      if (key.upArrow) return setCursor((at) => (at + ROWS.length - 1) % ROWS.length);
      if (key.downArrow) return setCursor((at) => (at + 1) % ROWS.length);
      if (key.return || input === ' ') return activate(row);
      if (input === 's') return onSave(draft);
      if (input === 'p') return setLive((was) => !was);
      if (row.kind === 'base' && (key.leftArrow || key.rightArrow)) {
        return stepBase(key.leftArrow ? -1 : 1);
      }
      if (row.kind !== 'role') return;
      const value = draft.colors[row.role];
      if (key.leftArrow || key.rightArrow) {
        setRole(row.role, rotateHue(value, key.leftArrow ? -HUE_STEP : HUE_STEP));
      } else if (input === '+' || input === '=') {
        setRole(row.role, shiftLightness(value, LIGHTNESS_STEP));
      } else if (input === '-') {
        setRole(row.role, shiftLightness(value, -LIGHTNESS_STEP));
      } else if (input === '#') {
        editHex(row.role, '#');
      }
    },
    { isActive: !prompt.isOpen },
  );

  //? The picture stays while a useful handful of rows still fits beside it (they scroll), and
  //? goes only on a pane too short for both — the rows are the editor
  const swatchRows = paletteSwatchRows(focus) + 1;
  const showSwatch = space === 0 || space - FIXED_ROWS - swatchRows >= MIN_ROWS_WITH_SWATCH;
  const budget = Math.max(3, space - FIXED_ROWS - (showSwatch ? swatchRows : 0));
  const start = Math.max(0, Math.min(cursor - Math.floor(budget / 2), ROWS.length - budget));
  const visible = ROWS.slice(start, start + budget);

  const textContrast = contrastRatio(draft.colors.text, draft.colors.surface);
  const accentContrast = contrastRatio(draft.colors.accentText, draft.colors.accent);
  const contrastColor = (ratio: number | undefined) =>
    ratio !== undefined && ratio < 4.5 ? colors.warn : colors.muted;

  const label = (text: string) => <Text color={colors.text}>{text.padEnd(LABEL_WIDTH)}</Text>;

  return (
    <Box ref={rootRef} flexDirection="column" flexGrow={1} overflow="hidden">
      <Text bold color={colors.accent} wrap="truncate">
        ✎ Custom theme · from {themeById(draft.basedOn).label}
      </Text>
      {showSwatch && (
        <Box marginBottom={1}>
          <PaletteSwatch colors={draft.colors} focus={focus} width={pane.width} />
        </Box>
      )}

      {visible.map((item, offset) => {
        const index = start + offset;
        const select = () => setCursor(index);
        const isSelected = index === cursor;
        const rowProps = { isSelected, onSelect: select, onActivate: () => activate(item) };
        if (item.kind === 'base') {
          return (
            <EditorRow key="base" {...rowProps}>
              {label('Based on')}
              <Text color={colors.accent}>‹ {themeById(draft.basedOn).label} ›</Text>
            </EditorRow>
          );
        }
        if (item.kind === 'background') {
          return (
            <EditorRow key="background" {...rowProps}>
              {label('Background')}
              <Text color={colors.text}>{draft.opaque ? 'painted' : 'terminal'}</Text>
              <Text color={colors.muted} wrap="truncate">
                {draft.opaque ? '  the surface colour, everywhere' : '  shows through'}
              </Text>
            </EditorRow>
          );
        }
        const value = draft.colors[item.role];
        return (
          <EditorRow key={item.role} {...rowProps}>
            {label(item.role)}
            <Text
              color={value}
              backgroundColor={
                item.role === 'accentText' ? draft.colors.accent : draft.colors.surface
              }
            >
              {item.role === 'accentText' ? 'Aa' : '██'}
            </Text>
            <Text color={isSelected ? colors.accent : colors.text}> {value.padEnd(9)}</Text>
            <Text color={colors.muted} wrap="truncate">
              {item.note}
            </Text>
          </EditorRow>
        );
      })}

      <Box flexGrow={1} />
      <Text wrap="truncate">
        <Text color={contrastColor(textContrast)}>text {ratioText(textContrast)}</Text>
        <Text color={colors.muted}> · </Text>
        <Text color={contrastColor(accentContrast)}>accent text {ratioText(accentContrast)}</Text>
        <Text color={colors.muted}> (4.5:1 reads comfortably)</Text>
      </Text>
      {prompt.line ?? (
        <Box flexWrap="wrap">
          <ActionButton hotkey="s" label="Save & use" color={colors.accent} onPress={() => onSave(draft)} />
          <ActionButton hotkey="p" label="Live preview" isOn={live} onPress={() => setLive((was) => !was)} />
          <ActionButton hotkey="Esc" label="Cancel" onPress={onCancel} />
        </Box>
      )}
      <Text color={colors.muted} wrap="truncate">
        {row.kind === 'role'
          ? 'Enter/# type a colour · ←/→ hue · +/- lighter/darker'
          : row.kind === 'base'
            ? '←/→ start from another theme'
            : 'Enter paints the background or leaves the terminal’s'}
      </Text>
    </Box>
  );
};

export default ThemeEditor;

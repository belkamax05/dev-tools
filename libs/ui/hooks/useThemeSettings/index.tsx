import { Text } from 'ink';
import { type ReactNode, useState } from 'react';

import Box from '../../components/Box';
import PaletteSwatch from '../../components/PaletteSwatch';
import type { PickItem } from '../../components/PickList';
import ThemeEditor from '../../components/ThemeEditor';
import { useColors, useThemeControl } from '../../providers/TuiThemeProvider';
import {
  CUSTOM_THEME_ID,
  type CustomThemeDraft,
  cloneTheme,
  saveCustomTheme,
  type ThemeDefinition,
  themeById,
  themesFilePath,
} from '../../theme';
import choiceRows from '../../utils/choiceRows';

/** A Settings row that picks a palette — or, with `EDIT_THEME_ID`, opens the editor. */
export interface ThemeSetting {
  kind: 'theme';
  id: string;
}

/** The "Customize…" row's id: not a palette, the way into the editor. */
export const EDIT_THEME_ID = '__edit';

export const isThemeSetting = (value: unknown): value is ThemeSetting =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'theme' &&
  typeof (value as { id?: unknown }).id === 'string';

export interface ThemeSettings {
  /** The "Theme" header, one row per palette (Custom last, once made), and "Customize…". */
  items: PickItem<ThemeSetting>[];
  /**
   * Whether this section answers for a row — its own rows, and, while the editor is open,
   * every row: the editor sits in the detail pane whatever the list's cursor (or a stray click)
   * lands on, and a click on another row must not apply it. A view checks this before its own
   * cases, in both its apply and its detail.
   */
  owns: (value: unknown) => value is ThemeSetting;
  /** Enter, Space or a click on one of its rows. */
  activate: (setting: ThemeSetting) => void;
  /** The detail pane for one of its rows — the editor, while it is open. */
  renderDetail: (setting: ThemeSetting) => ReactNode;
  /** True while the editor is open — for a view that names its detail pane. */
  isEditing: boolean;
}

/** Name, blurb and swatch: the detail pane for a palette row. */
const ThemePreview = ({ theme, isCurrent }: { theme: ThemeDefinition; isCurrent: boolean }) => {
  const colors = useColors();
  return (
    <Box flexDirection="column">
      <Text bold color={theme.colors.accent}>
        {theme.label}
        <Text color={colors.muted}>{isCurrent ? '  in use' : '  Enter to use'}</Text>
      </Text>
      <Text color={colors.muted} wrap="wrap">
        {theme.blurb}
      </Text>
      <Box marginTop={1}>
        <PaletteSwatch colors={theme.colors} width={40} />
      </Box>
    </Box>
  );
};

/**
 * The theme section of a Settings tab, whole: the palettes, the custom one, and its editor.
 *
 * Reads the palette in force and the way to change it from `useThemeControl`, which `AppShell`
 * provides when the app hands it `onPaletteChange` — so a view takes no theme props at all, and
 * the rows, what Enter does, the detail pane and the editor are written once here instead of
 * once per app. Row ids are `theme:<id>`, which is what a view remembering its row stores.
 *
 * "Customize…" clones the theme in force into the editor; saving makes it the custom theme
 * (one, shared by every dev-tools app — see `themeLibrary`) and switches to it, and the list is
 * where it was, with Custom marked in use.
 */
export const useThemeSettings = (): ThemeSettings => {
  const colors = useColors();
  const control = useThemeControl();
  const [editing, setEditing] = useState<CustomThemeDraft | undefined>(undefined);
  const current = themeById(control.id, control.themes);

  const items: PickItem<ThemeSetting>[] = [
    ...choiceRows({
      key: 'theme',
      header: 'Theme',
      choices: control.themes,
      idOf: (theme) => theme.id,
      label: (theme) => (theme.id === CUSTOM_THEME_ID ? `★ ${theme.label}` : theme.label),
      value: (theme) => ({ kind: 'theme' as const, id: theme.id }),
      current: control.id,
      accent: colors.accent,
    }),
    ...(control.select
      ? [
          {
            id: `theme:${EDIT_THEME_ID}`,
            label:
              current.id === CUSTOM_THEME_ID ? '✎ Edit Custom…' : `✎ Customize ${current.label}…`,
            hint: editing ? 'editing' : undefined,
            hintColor: colors.highlight,
            value: { kind: 'theme' as const, id: EDIT_THEME_ID },
          },
        ]
      : []),
  ];

  const activate = (setting: ThemeSetting) => {
    if (editing) return;
    if (setting.id === EDIT_THEME_ID) setEditing(cloneTheme(current));
    else control.select?.(setting.id);
  };

  const save = (draft: CustomThemeDraft) => {
    setEditing(undefined);
    //? Shown at once; the write finishing later only matters to the next app that starts
    void saveCustomTheme(draft).catch(() => {});
    control.select?.(CUSTOM_THEME_ID);
  };

  const renderDetail = (setting: ThemeSetting) => {
    if (editing) {
      return (
        <ThemeEditor initial={editing} onSave={save} onCancel={() => setEditing(undefined)} />
      );
    }
    if (setting.id === EDIT_THEME_ID) {
      return (
        <Box flexDirection="column">
          <Text bold color={colors.accent}>
            {current.id === CUSTOM_THEME_ID ? 'Edit your theme' : `Start from ${current.label}`}
          </Text>
          <Text color={colors.muted} wrap="wrap">
            {`Enter opens the editor on a copy of ${current.label}: every colour by hex, the whole app repainting as you go. Saving makes it the Custom theme — one, kept in ${themesFilePath()} and offered by every dev-tools app — and switches to it.`}
          </Text>
        </Box>
      );
    }
    const theme = control.themes.find((candidate) => candidate.id === setting.id);
    return theme ? <ThemePreview theme={theme} isCurrent={theme.id === control.id} /> : null;
  };

  return {
    items,
    owns: (value: unknown): value is ThemeSetting => Boolean(editing) || isThemeSetting(value),
    activate,
    renderDetail,
    isEditing: Boolean(editing),
  };
};

export default useThemeSettings;

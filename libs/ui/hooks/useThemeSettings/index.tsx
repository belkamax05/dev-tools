import { Text } from 'ink';
import { type ReactNode, useState } from 'react';

import Box from '../../components/Box';
import type { PickItem } from '../../components/PickList';
import ThemeEditor from '../../components/ThemeEditor';
import ThemePicker, { ThemeCard } from '../../components/ThemePicker';
import { useColors, useThemeControl } from '../../providers/TuiThemeProvider';
import {
  CUSTOM_THEME_ID,
  type CustomThemeDraft,
  cloneTheme,
  saveCustomTheme,
  themeById,
  themesFilePath,
} from '../../theme';

/** A Settings row: `PICK_THEME_ID` opens the theme dialog, `EDIT_THEME_ID` the editor. */
export interface ThemeSetting {
  kind: 'theme';
  id: string;
}

/** The "Customize…" row's id: not a palette, the way into the editor. */
export const EDIT_THEME_ID = '__edit';

/** The one palette row's id: it shows the theme in force and opens the dialog of the rest. */
export const PICK_THEME_ID = '__pick';

export const isThemeSetting = (value: unknown): value is ThemeSetting =>
  typeof value === 'object' &&
  value !== null &&
  (value as { kind?: unknown }).kind === 'theme' &&
  typeof (value as { id?: unknown }).id === 'string';

export interface ThemeSettings {
  /** The "Theme" header, the theme in force (Enter opens the dialog of all), and "Customize…". */
  items: PickItem<ThemeSetting>[];
  /**
   * Whether this section answers for a row — its own rows, and, while the editor or the theme
   * dialog is open, every row: either sits in the detail pane whatever the list's cursor (or a stray click)
   * lands on, and a click on another row must not apply it. A view checks this before its own
   * cases, in both its apply and its detail.
   */
  owns: (value: unknown) => value is ThemeSetting;
  /** Enter, Space or a click on one of its rows. */
  activate: (setting: ThemeSetting) => void;
  /** The detail pane for one of its rows — the editor, while it is open. */
  renderDetail: (setting: ThemeSetting) => ReactNode;
  /** True while the editor or the theme dialog is open — for a view that names its detail pane. */
  isEditing: boolean;
}

/**
 * The theme section of a Settings tab, whole: the theme in force, the dialog that changes it,
 * and the custom theme's editor.
 *
 * Only the theme in force is a row. The palettes are a dozen and growing, and listed inline they
 * pushed every other setting below the fold for a choice made once; Enter on the row opens
 * `ThemePicker` in the detail pane, which repaints the app as its cursor moves.
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
  const [picking, setPicking] = useState(false);
  const current = themeById(control.id, control.themes);

  const items: PickItem<ThemeSetting>[] = [
    { id: 'header-theme', label: 'Theme', isHeader: true },
    {
      id: `theme:${PICK_THEME_ID}`,
      label: current.id === CUSTOM_THEME_ID ? `★ ${current.label}` : current.label,
      hint: picking ? 'choosing' : control.select ? 'change…' : 'in use',
      hintColor: picking ? colors.highlight : colors.accent,
      isCurrent: true,
      value: { kind: 'theme' as const, id: PICK_THEME_ID },
    },
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
    if (editing || picking || !control.select) return;
    if (setting.id === EDIT_THEME_ID) setEditing(cloneTheme(current));
    else if (setting.id === PICK_THEME_ID) setPicking(true);
    else control.select(setting.id);
  };

  const pick = (id: string) => {
    setPicking(false);
    control.select?.(id);
  };

  const save = (draft: CustomThemeDraft) => {
    setEditing(undefined);
    //? Shown at once; the write finishing later only matters to the next app that starts
    void saveCustomTheme(draft).catch(() => {});
    control.select?.(CUSTOM_THEME_ID);
  };

  const renderDetail = (setting: ThemeSetting) => {
    if (picking) {
      return (
        <ThemePicker
          themes={control.themes}
          current={control.id}
          onPick={pick}
          onCancel={() => setPicking(false)}
        />
      );
    }
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
    if (setting.id === PICK_THEME_ID) {
      return (
        <ThemeCard
          theme={current}
          note={control.select ? `in use · Enter to choose from ${control.themes.length}` : 'in use'}
        />
      );
    }
    return null;
  };

  return {
    items,
    owns: (value: unknown): value is ThemeSetting =>
      Boolean(editing) || picking || isThemeSetting(value),
    activate,
    renderDetail,
    isEditing: Boolean(editing) || picking,
  };
};

export default useThemeSettings;

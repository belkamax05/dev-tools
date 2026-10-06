import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { appConfigDir } from '../../../utils/config/configHome';
import { normalizeColor } from '../colorMath';
import { COLOR_ROLES, type Palette, type ThemeDefinition, themeById } from '../palettes';

/**
 * The palettes a person made, on top of the stock ones — and the one being made right now.
 *
 * One custom theme, not a library of them: the switcher stays the fixed list plus "Custom", and
 * making another means editing that one. It lives in one file for every dev-tools app
 * (`~/.config/dev-tools/themes.json`) rather than in each app's config, so a theme built in
 * one app is there in all of them; which theme each app *uses* stays in its own config.
 *
 * Module state rather than React state, because the readers are everywhere — the shell
 * resolving colours, every Settings tab listing themes — and none of them owns it.
 * `useThemeLibrary` subscribes a component to it.
 */

export const CUSTOM_THEME_ID = 'custom';

/** What is stored, and what the editor works on. */
export interface CustomThemeDraft {
  /** The stock theme it was cloned from — named in its blurb. */
  basedOn: string;
  colors: Palette;
  opaque: boolean;
}

export const themesFilePath = (): string => join(appConfigDir('dev-tools'), 'themes.json');

/** A draft as the theme the switcher offers. */
export const customThemeFrom = (draft: CustomThemeDraft): ThemeDefinition => ({
  id: CUSTOM_THEME_ID,
  label: 'Custom',
  blurb: `Your own, started from ${themeById(draft.basedOn).label}. Shared by every dev-tools app.`,
  colors: draft.colors,
  opaque: draft.opaque,
});

/** A fresh draft: a copy of `theme`, to edit. */
export const cloneTheme = (theme: ThemeDefinition): CustomThemeDraft => ({
  basedOn: theme.id === CUSTOM_THEME_ID ? themeById(undefined).id : theme.id,
  colors: { ...theme.colors },
  opaque: Boolean(theme.opaque),
});

/**
 * Whatever the file holds, as a draft — every role a valid colour, falling back role by role
 * to the theme it was based on, so a hand-edited file with one typo loses one colour, not all.
 */
export const parseCustomTheme = (raw: unknown): CustomThemeDraft | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const custom = (raw as { custom?: unknown }).custom;
  if (typeof custom !== 'object' || custom === null) return undefined;
  const { basedOn, colors, opaque } = custom as Record<string, unknown>;
  const base = themeById(typeof basedOn === 'string' ? basedOn : undefined);
  const stored = typeof colors === 'object' && colors !== null ? (colors as Record<string, unknown>) : {};
  const palette = { ...base.colors };
  for (const { role } of COLOR_ROLES) {
    const value = stored[role];
    const color = typeof value === 'string' ? normalizeColor(value) : undefined;
    if (color) palette[role] = color;
  }
  return { basedOn: base.id, colors: palette, opaque: opaque === true };
};

let loaded = false;
let custom: ThemeDefinition | undefined;
let preview: ThemeDefinition | undefined;
let version = 0;
const listeners = new Set<() => void>();

const changed = () => {
  version += 1;
  for (const listener of listeners) listener();
};

/**
 * Read synchronously, on first use. It is a few hundred bytes, and reading it later would put
 * one frame on screen in the fallback theme before the custom one arrived — the flash an app
 * that starts on "Custom" would show every single time.
 */
const ensureLoaded = () => {
  if (loaded) return;
  loaded = true;
  try {
    const draft = parseCustomTheme(JSON.parse(readFileSync(themesFilePath(), 'utf8')));
    custom = draft && customThemeFrom(draft);
  } catch {
    custom = undefined;
  }
};

/** The custom theme, if one was ever saved. */
export const getCustomTheme = (): ThemeDefinition | undefined => {
  ensureLoaded();
  return custom;
};

/** Make `draft` the custom theme — in every component now, and on disk as soon as it is written. */
export const saveCustomTheme = async (draft: CustomThemeDraft): Promise<void> => {
  loaded = true;
  custom = customThemeFrom(draft);
  changed();
  await Bun.write(themesFilePath(), `${JSON.stringify({ custom: draft }, null, 2)}\n`);
};

/** The theme being edited, drawn everywhere in place of the one in force — or undefined. */
export const getPreviewTheme = (): ThemeDefinition | undefined => preview;

export const setPreviewTheme = (theme: ThemeDefinition | undefined): void => {
  if (theme === preview) return;
  preview = theme;
  changed();
};

/** For `useSyncExternalStore`: a number that changes whenever anything above does. */
export const themeLibraryVersion = (): number => version;

export const subscribeThemeLibrary = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** `themes` with the custom theme, if any, appended — idempotent, so it can be applied twice. */
export const withCustomTheme = (themes: ThemeDefinition[]): ThemeDefinition[] => {
  const mine = getCustomTheme();
  const stock = themes.filter((theme) => theme.id !== CUSTOM_THEME_ID);
  return mine ? [...stock, mine] : stock;
};

/** Forget the cached state — for tests that point the config home somewhere else. */
export const resetThemeLibrary = (): void => {
  loaded = false;
  custom = undefined;
  preview = undefined;
  changed();
};

export const themeLibrary = {
  CUSTOM_THEME_ID,
  cloneTheme,
  customThemeFrom,
  getCustomTheme,
  getPreviewTheme,
  parseCustomTheme,
  resetThemeLibrary,
  saveCustomTheme,
  setPreviewTheme,
  subscribeThemeLibrary,
  themeLibraryVersion,
  themesFilePath,
  withCustomTheme,
} as const;

export default themeLibrary;

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

import {
  createTheme,
  DEFAULT_THEME_ID,
  defaultTheme,
  getPreviewTheme,
  nextThemeId,
  type Palette,
  subscribeThemeLibrary,
  THEMES,
  type ThemeDefinition,
  TRANSPARENT,
  type TuiTheme,
  themeById,
  themeLibraryVersion,
  withCustomTheme,
} from '../../theme';

export interface ThemeColors extends Palette {
  /**
   * What the app paints behind itself: the theme's surface, or `TRANSPARENT`.
   *
   * Transparent is the default and the reason this is separate from `surface`:
   * a TUI that draws no background inherits the terminal's, which is what makes
   * it look like part of the terminal rather than a window sitting on top of
   * one — transparency, blur and all. Opting in to a solid colour is for the
   * opposite case, where the app is meant to look like an application.
   *
   * Always a string rather than sometimes `undefined`, because Ink treats the
   * two differently in a way that has nothing to do with colour — see
   * `TRANSPARENT`.
   */
  page: string;
}

/**
 * One theme id and one background choice, resolved into colours to draw with.
 *
 * Exported because an app shell is usually both the provider and a component
 * that draws: it cannot read its own context, so it resolves the value once with
 * this and hands the same object to the provider — one function, one answer, no
 * chance of the shell and everything under it disagreeing about what theme is on.
 *
 * `preview`, when given, is drawn instead of the palette in force — the theme editor's draft.
 * A theme that is `opaque` paints its background whatever the app asked for.
 */
export const resolveColors = (
  paletteId: string | undefined,
  opaqueBackground: boolean,
  theme: TuiTheme = defaultTheme,
  preview?: ThemeDefinition,
): ThemeColors => {
  const definition = preview ?? themeById(paletteId, theme.palettes);
  const { colors } = definition;
  return {
    ...colors,
    page: opaqueBackground || definition.opaque ? colors.surface : TRANSPARENT,
  };
};

/**
 * Classic, transparent, stock tables — what a TUI looks like before it has said
 * anything about itself.
 *
 * Real values rather than `null` sentinels is what lets any component be
 * rendered without a provider: every test that mounts a view on its own, and any
 * screen that draws before a config has been read, gets the defaults instead of
 * a crash or a missing colour.
 */
const DEFAULT_COLORS: ThemeColors = resolveColors(DEFAULT_THEME_ID, false);

/**
 * Which palette is on, and the one way to change it.
 *
 * In context rather than threaded through props because three unrelated places
 * need it — the shell's `t` key, its footer button, and a Settings tab's theme
 * rows (`useThemeSettings`). Every app used to carry the id and a change
 * callback down to each of them by hand, with its own copy of the cycling and
 * of the rows at the end of it.
 */
export interface ThemeControl {
  /** The palette in force — the resolved one, so an unknown id marks the fallback as current. */
  id: string;
  /** Every palette on offer, in switcher order. */
  themes: ThemeDefinition[];
  /** Switch palettes. Undefined when the app gave the provider no way to change it. */
  select?: (id: string) => void;
  /** Step through `themes`, wrapping — what `t` does. A no-op without `select`. */
  cycle: (step?: number) => void;
}

/** The control for one palette id and change callback — the provider's, and `AppShell`'s for `t`. */
export const resolveThemeControl = (
  paletteId: string | undefined,
  themes: ThemeDefinition[],
  onPaletteChange?: (id: string) => void,
): ThemeControl => {
  const id = themeById(paletteId, themes).id;
  return {
    id,
    themes,
    select: onPaletteChange,
    cycle: (step = 1) => onPaletteChange?.(nextThemeId(id, step, themes)),
  };
};

const ThemeContext = createContext<TuiTheme>(defaultTheme);
const ColorsContext = createContext<ThemeColors>(DEFAULT_COLORS);
const ThemeControlContext = createContext<ThemeControl>(
  resolveThemeControl(DEFAULT_THEME_ID, THEMES),
);

export interface TuiThemeProviderProps {
  /** Sizes, breakpoints and display rules. Defaults to the stock tables. */
  theme?: TuiTheme;
  /** Palette id from the app's config. Anything unrecognised falls back. */
  palette?: string;
  /** Paint the app's background rather than letting the terminal's show through. */
  opaqueBackground?: boolean;
  /** Apply and persist a palette change. Left out, the theme is fixed: see `ThemeControl.select`. */
  onPaletteChange?: (id: string) => void;
  children: ReactNode;
}

export interface ResolvedTheme {
  /** The tables, with the custom theme added to the stock palettes. */
  theme: TuiTheme;
  colors: ThemeColors;
  control: ThemeControl;
}

/**
 * Everything the provider puts in context, from the provider's own props.
 *
 * A hook rather than three calls so `AppShell`, which draws with the same answer it provides,
 * cannot work it out differently. It subscribes to the theme library, so saving a custom
 * theme or editing one live repaints the whole app.
 */
export const useResolvedTheme = ({
  theme,
  palette,
  opaqueBackground = false,
  onPaletteChange,
}: Omit<TuiThemeProviderProps, 'children'>): ResolvedTheme => {
  const library = useSyncExternalStore(subscribeThemeLibrary, themeLibraryVersion);
  const resolvedTheme = useMemo(() => {
    const base = theme ?? createTheme();
    return { ...base, palettes: withCustomTheme(base.palettes) };
    // biome-ignore lint/correctness/useExhaustiveDependencies: `library` is the trigger — the custom theme is read from the library itself
  }, [theme, library]);
  const preview = getPreviewTheme();
  const colors = useMemo(
    () => resolveColors(palette, opaqueBackground, resolvedTheme, preview),
    [palette, opaqueBackground, resolvedTheme, preview],
  );
  const control = useMemo(
    () => resolveThemeControl(palette, resolvedTheme.palettes, onPaletteChange),
    [palette, resolvedTheme, onPaletteChange],
  );
  return { theme: resolvedTheme, colors, control };
};

/**
 * Puts one theme's tables and colours in reach of every component below it.
 *
 * Context rather than module-level state that a switcher mutates: Ink re-renders
 * on state changes, not on a variable changing behind its back, and a theme that
 * only applied to the parts of the screen that happened to re-render next is
 * worse than no theme switcher at all.
 */
export const TuiThemeProvider = ({ children, ...props }: TuiThemeProviderProps) => {
  const { theme: resolvedTheme, colors, control } = useResolvedTheme(props);

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <ColorsContext.Provider value={colors}>
        <ThemeControlContext.Provider value={control}>{children}</ThemeControlContext.Provider>
      </ColorsContext.Provider>
    </ThemeContext.Provider>
  );
};

/** The sizes, breakpoints, chrome prices and display rules in force. */
export const useTuiTheme = (): TuiTheme => useContext(ThemeContext);

/**
 * The colours to draw with.
 *
 * Called `useColors` and not `useTheme` because `theme` already means the sizes,
 * breakpoints and display rules — a hook by that name sitting next to
 * `theme.sizes` would read as the same thing twice.
 */
export const useColors = (): ThemeColors => useContext(ColorsContext);

/** Which palette is on, every palette there is, and how to switch — see `ThemeControl`. */
export const useThemeControl = (): ThemeControl => useContext(ThemeControlContext);

export default TuiThemeProvider;

import type { ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

import {
  createTheme,
  DEFAULT_THEME_ID,
  defaultTheme,
  type Palette,
  paletteFor,
  TRANSPARENT,
  type TuiTheme,
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
 */
export const resolveColors = (
  paletteId: string | undefined,
  opaqueBackground: boolean,
  theme: TuiTheme = defaultTheme,
): ThemeColors => {
  const palette = paletteFor(paletteId, theme.palettes);
  return { ...palette, page: opaqueBackground ? palette.surface : TRANSPARENT };
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

const ThemeContext = createContext<TuiTheme>(defaultTheme);
const ColorsContext = createContext<ThemeColors>(DEFAULT_COLORS);

export interface TuiThemeProviderProps {
  /** Sizes, breakpoints and display rules. Defaults to the stock tables. */
  theme?: TuiTheme;
  /** Palette id from the app's config. Anything unrecognised falls back. */
  palette?: string;
  /** Paint the app's background rather than letting the terminal's show through. */
  opaqueBackground?: boolean;
  children: ReactNode;
}

/**
 * Puts one theme's tables and colours in reach of every component below it.
 *
 * Context rather than module-level state that a switcher mutates: Ink re-renders
 * on state changes, not on a variable changing behind its back, and a theme that
 * only applied to the parts of the screen that happened to re-render next is
 * worse than no theme switcher at all.
 */
export const TuiThemeProvider = ({
  theme,
  palette,
  opaqueBackground = false,
  children,
}: TuiThemeProviderProps) => {
  const resolvedTheme = useMemo(() => theme ?? createTheme(), [theme]);
  const colors = useMemo(
    () => resolveColors(palette, opaqueBackground, resolvedTheme),
    [palette, opaqueBackground, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <ColorsContext.Provider value={colors}>{children}</ColorsContext.Provider>
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

export default TuiThemeProvider;

import breakpointsDefault, { type Breakpoints } from '../breakpoints';
import chromeDefault, { type ChromeTable } from '../chrome';
import displayDefault, { type DisplayTable } from '../display';
import { THEMES, type ThemeDefinition } from '../palettes';
import sizesDefault, { type AppSizes } from '../sizes';
import timingsDefault, { type Timings } from '../timings';

/**
 * Every size- and colour-dependent decision a TUI makes, in one object.
 *
 * - `breakpoints` — named terminal tiers per axis, the media-query analogue.
 * - `chrome` — what the furniture costs in rows, so a region can budget for it.
 * - `sizes` — fixed widths and the minimum terminal the app will draw itself in.
 * - `display` — what is worth drawing at a given size, and what dropping it buys.
 * - `timings` — how long the interface holds something on screen.
 * - `palettes` — the themes a switcher offers.
 *
 * Components never read `stdout.columns` or compare against a threshold
 * themselves; they call `useViewport()` and read the answer. Colours work the
 * same way through `useColors()`.
 */
export interface TuiTheme {
  breakpoints: Breakpoints;
  chrome: ChromeTable;
  display: DisplayTable;
  sizes: { app: AppSizes } & Record<string, unknown>;
  timings: Timings;
  palettes: ThemeDefinition[];
}

export interface TuiThemeOverrides {
  breakpoints?: Partial<Breakpoints>;
  chrome?: ChromeTable;
  display?: DisplayTable;
  sizes?: { app?: Partial<AppSizes> } & Record<string, unknown>;
  timings?: Timings;
  palettes?: ThemeDefinition[];
}

/**
 * The stock theme with an app's own tables merged over it.
 *
 * Shallow per section and one level deep for the two nested ones, which is the
 * whole of what a theme is: an app that wants a different `rows.regular` should
 * not have to restate `columns`, and one that adds a `display` element should
 * not lose `barBorders` — the one rule the shared components read.
 */
/**
 * Merge a table, letting the override decide the order.
 *
 * Key order is not cosmetic in `display`: it is the order elements are shed as
 * the terminal shrinks, and `hiddenLabels` reports them in it. A plain spread
 * puts the stock `barBorders` first, which silently reorders an app's carefully
 * argued shed order behind its back — dygma's "hand captions before bar frames"
 * became "bar frames before hand captions" with no code saying so.
 *
 * So the override's keys come first, in its order, and anything the app did not
 * mention is appended.
 */
const mergeOrdered = <T>(
  base: Record<string, T>,
  override: Record<string, T> | undefined,
): Record<string, T> => {
  if (!override) return { ...base };

  const merged: Record<string, T> = { ...override };
  for (const key of Object.keys(base)) {
    if (!(key in merged)) merged[key] = base[key] as T;
  }
  return merged;
};

export const createTheme = (overrides: TuiThemeOverrides = {}): TuiTheme => {
  const breakpoints: Breakpoints = {
    columns: { ...breakpointsDefault.columns, ...overrides.breakpoints?.columns },
    rows: { ...breakpointsDefault.rows, ...overrides.breakpoints?.rows },
  };

  return {
    breakpoints,
    chrome: { ...chromeDefault, ...overrides.chrome },
    //? Built from the merged breakpoints, not the stock ones: `barBorders` is
    //? stated in terms of `rows.regular`, so an app that moves that threshold
    //? and says nothing about display still gets frames shed at its own size.
    display: mergeOrdered(displayDefault(breakpoints), overrides.display),
    sizes: {
      ...sizesDefault,
      ...overrides.sizes,
      app: { ...sizesDefault.app, ...overrides.sizes?.app },
    },
    timings: { ...timingsDefault, ...overrides.timings },
    palettes: overrides.palettes ?? THEMES,
  };
};

export const defaultTheme: TuiTheme = createTheme();

export default createTheme;

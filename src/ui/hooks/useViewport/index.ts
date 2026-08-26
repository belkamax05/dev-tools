import { useMemo } from 'react';

import { useTuiTheme } from '../../providers/TuiThemeProvider';
import { ascending, contentRows, pickByTier, resolveDisplay, tierFor } from '../../theme';
import useTerminalSize from '../useTerminalSize';

/**
 * A value per tier, cascading upwards from the smallest.
 *
 * The smallest tier is required and the rest are optional, so a map always has
 * an answer and only says what actually changes — CSS's smallest-first cascade,
 * which for a terminal means the size every terminal is at least as big as.
 */
export type ByTier<T> = Partial<Record<string, T>>;

export interface Viewport {
  columns: number;
  rows: number;
  columnTier: string;
  rowTier: string;
  /** Whether each element in `theme.display` has the room it asks for. */
  shows: Record<string, boolean>;
  /** Pick the value for this terminal's width. */
  byColumns: <T>(values: ByTier<T>) => T;
  /** Pick the value for this terminal's height. */
  byRows: <T>(values: ByTier<T>) => T;
  /** Rows left for content once the listed chrome has taken its share. */
  contentRows: (parts: readonly string[], min?: number) => number;
}

/**
 * The terminal, and what the theme says to do with one this size.
 *
 * This is the `useMediaQuery` of a TUI: the single subscription to resizes and
 * the single place a threshold is compared against. `useTerminalSize` still
 * exists for the rare caller that wants raw cells and no opinions.
 */
export const useViewport = (): Viewport => {
  const { columns, rows } = useTerminalSize();
  const theme = useTuiTheme();

  return useMemo(() => {
    const columnOrder = ascending(theme.breakpoints.columns);
    const rowOrder = ascending(theme.breakpoints.rows);
    const columnTier = tierFor(theme.breakpoints.columns, columnOrder, columns);
    const rowTier = tierFor(theme.breakpoints.rows, rowOrder, rows);
    const shows = resolveDisplay(theme.display, columns, rows);

    return {
      columns,
      rows,
      columnTier,
      rowTier,
      shows,
      byColumns: <T>(values: ByTier<T>): T => pickByTier<T>(columnOrder, columnTier, values),
      byRows: <T>(values: ByTier<T>): T => pickByTier<T>(rowOrder, rowTier, values),
      //? Priced against the frames this size actually draws, so a list never
      //? budgets for a border that is not there — or misses one that is.
      contentRows: (parts, min) =>
        contentRows(theme.chrome, rows, parts, { bordered: shows.barBorders !== false, min }),
    };
  }, [columns, rows, theme]);
};

export default useViewport;

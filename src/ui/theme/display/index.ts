import breakpoints, { type Breakpoints } from '../breakpoints';

/**
 * Which elements a terminal is big enough to be worth drawing.
 *
 * This is `display: none` under a media query, gathered into one table instead
 * of scattered across the components that happen to render each element. A
 * component asks `viewport.shows.barBorders`; only the table knows what that
 * costs and when it stops being affordable.
 *
 * A table should be ordered the way things are shed as the terminal shrinks,
 * cheapest meaning first.
 */
export interface DisplayRule {
  /** How the element is named when something has to say it was dropped. */
  label: string;
  /** Rows the terminal must have before this element earns its space. */
  minRows?: number;
  /** Columns the terminal must have before this element earns its space. */
  minColumns?: number;
  /** Another element this one is meaningless without. */
  requires?: string;
  /** What dropping it buys back — why the threshold above is where it is. */
  costRows?: number;
  costColumns?: number;
}

export type DisplayTable = Record<string, DisplayRule>;

/**
 * The one rule the shared components read for themselves.
 *
 * `barBorders` is the worst rows-per-meaning trade in a TUI: a frame costs two
 * rows to say something one row of text already said. `Bar`, `ClickableTab` and
 * the shell all shed theirs at the same point, and the blank row either side of
 * a strip stays — separation for one row instead of two.
 */
export const display = (limits: Breakpoints = breakpoints): DisplayTable => ({
  barBorders: {
    label: 'bar frames',
    minRows: limits.rows.regular ?? 32,
    /**
     * Also a columns rule, because a frame costs two columns as well as two
     * rows. A row of readouts that only fits unframed will otherwise wrap, and a
     * one-row strip that silently becomes two rows tall breaks every row budget
     * priced against it.
     */
    minColumns: 85,
    costRows: 8,
  },
});

/**
 * The table answered for one terminal size.
 *
 * A plain function rather than a hook so the rules can be checked without a
 * React render, and read by anything that knows a size but not a terminal.
 */
export const resolveDisplay = (
  table: DisplayTable,
  columns: number,
  rows: number,
): Record<string, boolean> => {
  const resolved: Record<string, boolean> = {};

  const fits = (element: string, seen: Set<string>): boolean => {
    if (element in resolved) return resolved[element] as boolean;
    //? A rule that requires its way back to itself would recurse forever. Treat
    //? the cycle as a misconfiguration and show the element rather than hang.
    if (seen.has(element)) return true;
    seen.add(element);

    const rule = table[element];
    if (!rule) return true;

    const roomy =
      (rule.minRows === undefined || rows >= rule.minRows) &&
      (rule.minColumns === undefined || columns >= rule.minColumns);
    const shown = roomy && (rule.requires === undefined || fits(rule.requires, seen));

    resolved[element] = shown;
    return shown;
  };

  for (const element of Object.keys(table)) fits(element, new Set());
  return resolved;
};

/**
 * What this size is costing, named — in the order the elements were shed.
 *
 * An element hidden only because what it `requires` is hidden is left out: the
 * detail rules are not news when the frames they sit in are already gone.
 */
export const hiddenLabels = (table: DisplayTable, shows: Record<string, boolean>): string[] =>
  Object.keys(table)
    .filter((element) => {
      if (shows[element]) return false;
      const requires = (table[element] as DisplayRule).requires;
      return requires === undefined || shows[requires] !== false;
    })
    .map((element) => (table[element] as DisplayRule).label);

export default display;

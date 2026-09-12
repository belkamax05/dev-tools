/**
 * What an app's furniture costs, in terminal rows.
 *
 * CSS has no equivalent and does not need one: a browser scrolls whatever does
 * not fit. Ink draws every child it is given, so a list has to be sliced to the
 * rows actually left over — and the only way to know that is to subtract the
 * chrome around it. Overshooting is not cosmetic: the frame grows taller than
 * the terminal, scrolls it, and the next frame draws a row on top of another.
 *
 * A part whose frame is shed on a short terminal (`display.barBorders`) costs
 * two rows less once it is, so its price is a pair rather than a number. The
 * budget has to move with what is drawn — a list sized against the framed price
 * on an unframed terminal wastes two rows, and the other way round corrupts the
 * frame.
 */
export type ChromeCost = number | { bordered: number; plain: number };

export type ChromeTable = Record<string, ChromeCost>;

/** The stock parts. Apps add their own and override these by name. */
export const chrome = {
  /**
   * Header 3 · tab bar 4 · footer 4 · the row the shell holds back from Ink 1.
   * Unframed, the tab bar and footer cost 2 apiece: their text and the blank
   * row that separates them, which is kept because it separates for half the
   * price of a border.
   */
  appShell: { bordered: 12, plain: 8 },
  /** A view's summary strip: border 2, its line of text, the blank row under it. */
  summaryBar: { bordered: 4, plain: 2 },
  /** A view's hint strip: border 2, the hints line, the status line. */
  hintBar: { bordered: 4, plain: 2 },
  /**
   * A scrolling panel: border 2, title row 1, a "N more" row at each end 2, and
   * one row of slack — a list that guesses low just scrolls, a list that guesses
   * high corrupts the frame. Its border stays at every size: it is what tells
   * two panels sitting side by side apart.
   */
  panelFrame: 6,
} satisfies ChromeTable;

/** What one part costs on a terminal that is or is not drawing bar frames. */
export const chromeCost = (table: ChromeTable, part: string, bordered: boolean): number => {
  const cost = table[part];
  if (cost === undefined) return 0;
  if (typeof cost === 'number') return cost;
  return bordered ? cost.bordered : cost.plain;
};

/**
 * Rows left for content once `parts` have taken theirs.
 *
 * `min` is a floor, not a promise: on a terminal too short for the chrome alone
 * the layout is already lost, and a panel showing one row beats one showing
 * none.
 */
export const contentRows = (
  table: ChromeTable,
  rows: number,
  parts: readonly string[],
  { bordered = true, min = 1 }: { bordered?: boolean; min?: number } = {},
): number => {
  const spent = parts.reduce((total, part) => total + chromeCost(table, part, bordered), 0);
  return Math.max(min, rows - spent);
};

export default chrome;

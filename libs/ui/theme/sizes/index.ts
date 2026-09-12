/**
 * Fixed sizes, in cells.
 *
 * The MUI analogue is `theme.spacing` and the fixed widths a design system pins
 * on its components. Every number here is whole cells — a terminal has no
 * fractional unit, and no `rem` to scale one from.
 */
export interface AppSizes {
  /** Below this the app draws `TerminalTooSmall` instead of itself. */
  minWidth: number;
  minHeight: number;
  /** Columns the shell leaves either side of its frame, in total. */
  horizontalMargin: number;
  /**
   * Rows the shell never draws on, kept back from Ink at the bottom.
   *
   * Ink writes its last row and the terminal's cursor lands on the row after
   * it; on a frame exactly as tall as the terminal that row does not exist, so
   * the terminal scrolls to make one — and every frame after that is drawn one
   * line higher than the last, sliding the whole app up the screen. Holding a
   * row back is what stops that, and `chrome.appShell` prices it in.
   */
  heldBackRows: number;
}

export const sizes = {
  app: {
    minWidth: 60,
    minHeight: 16,
    horizontalMargin: 2,
    heldBackRows: 1,
  },
} satisfies { app: AppSizes };

export type Sizes = { app: AppSizes } & Record<string, unknown>;

/** Cells inside a `Bar` on a terminal this wide — the app margin, the bar's
 * `paddingX`, and its frame where the terminal is tall enough to draw one. */
export const barInnerWidth = (columns: number, framed: boolean, app: AppSizes): number => {
  const appWidth = Math.max(columns - app.horizontalMargin, app.minWidth);
  return appWidth - 2 /* paddingX */ - (framed ? 2 : 0);
};

export default sizes;

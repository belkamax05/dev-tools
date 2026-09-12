import { createTheme } from '@/dev-tools/ui/theme';

/**
 * giti's own sizes and row prices, over the stock tables.
 *
 * The stock `chrome.appShell` already prices `AppShell` exactly — header 3, tab
 * strip 4, footer 4, and the row held back — so it is left alone. What giti adds
 * is the one part of its own layout that costs rows: the hint strip every view
 * draws under its panes.
 *
 * The minimums are raised because a dashboard is two panes side by side. At the
 * stock 60 columns the detail pane is roughly twenty cells wide, which is not
 * enough for a commit subject or a remote URL to say anything, and a pane that
 * can only show an ellipsis is worse than a terminal that admits it is too small.
 */
export const gitiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    appShell: { bordered: 12, plain: 8 },
    summaryBar: { bordered: 4, plain: 2 },
    hintBar: { bordered: 4, plain: 2 },
    panelFrame: 6,
    /**
     * A view's hint strip: the row of hints, and the blank row above it.
     *
     * Unframed at every size, unlike the stock `hintBar`. The strip sits
     * directly under a pane that already has a border of its own, and a second
     * frame two rows below the first reads as a box inside a box rather than as
     * a caption under one.
     */
    viewHints: 2,
  },
});

export default gitiTheme;

import { chrome, createTheme } from '@/dev-tools/ui/theme';

/** Rows the IDE strip under the tabs takes — a logo's height. */
export const IDE_STRIP_ROWS = 2;

/** The IDE strip, on every tab: its rows and the blank one under it. */
const IDE_STRIP_COST = IDE_STRIP_ROWS + 1;

/**
 * agenti's sizes over the stock tables.
 *
 * Every view is a list beside a detail pane, so the minimums are giti's: below
 * 72 columns the detail pane is too narrow for a path or a diff line to say
 * anything. `ListDetail`'s own hint strip is already priced in the stock
 * chrome as `viewHints`; what is added here is the one-line prompt/status row
 * each view draws above its list, and the IDE strip every tab has under the
 * tab bar — priced into `appShell` itself, since every view already pays that.
 */
export const agentiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 + IDE_STRIP_COST },
  },
  chrome: {
    appShell: {
      bordered: chrome.appShell.bordered + IDE_STRIP_COST,
      plain: chrome.appShell.plain + IDE_STRIP_COST,
    },
    viewHeader: 1,
  },
});

export default agentiTheme;

import { chrome, createTheme } from '@/dev-tools/ui/theme';

/** The connections row under the tab bar — clickable, on every tab. */
const STATUS_ROW = 1;

/**
 * depli's sizes over the stock tables: a list beside its detail, with the rows the views draw
 * above it — the env chips.
 */
export const depliTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 20 },
  },
  chrome: {
    appShell: {
      bordered: chrome.appShell.bordered + STATUS_ROW,
      plain: chrome.appShell.plain + STATUS_ROW,
    },
    viewHeader: 1,
    chipRow: 1,
  },
});

export default depliTheme;

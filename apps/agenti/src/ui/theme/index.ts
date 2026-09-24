import { createTheme } from '@/dev-tools/ui/theme';

/**
 * agenti's sizes over the stock tables.
 *
 * Every view is a list beside a detail pane, so the minimums are giti's: below
 * 72 columns the detail pane is too narrow for a path or a diff line to say
 * anything. `ListDetail`'s own hint strip is already priced in the stock
 * chrome as `viewHints`; what is added here is the one-line prompt/status row
 * each view draws above its list.
 */
export const agentiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
  },
});

export default agentiTheme;

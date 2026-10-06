import { createTheme } from '@/dev-tools/ui/theme';

/**
 * bmi's sizes over the stock tables: porti's, since every view is the same list beside a detail
 * pane, plus the one-line summary/search row each view draws above its list.
 */
export const bmiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
  },
});

export default bmiTheme;

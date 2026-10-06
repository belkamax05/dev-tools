import { createTheme } from '@/dev-tools/ui/theme';

/**
 * pkgi's sizes over the stock tables: agenti's list-beside-detail minimums, plus the one-line
 * summary/prompt row every view draws above its list.
 */
export const pkgiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
  },
});

export default pkgiTheme;

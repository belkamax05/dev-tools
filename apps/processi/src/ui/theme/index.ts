import { createTheme } from '@/dev-tools/ui/theme';

/**
 * processi's sizes over the stock tables: agenti's list-beside-detail minimums, plus the two rows
 * the process views draw above their list — the summary/prompt line and the scope/sort chips.
 */
export const processiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
    chipRow: 1,
  },
});

export default processiTheme;

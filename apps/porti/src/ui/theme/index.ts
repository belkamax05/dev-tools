import { createTheme } from '@/dev-tools/ui/theme';

/**
 * porti's sizes over the stock tables: agenti's, since every view is the same list beside a
 * detail pane, plus the one-line summary/prompt row each view draws above its list.
 */
export const portiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
  },
});

export default portiTheme;

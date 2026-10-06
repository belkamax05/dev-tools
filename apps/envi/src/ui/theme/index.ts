import { createTheme } from '@/dev-tools/ui/theme';

/**
 * envi's sizes over the stock tables: porti's — every view is a list beside a detail pane, with
 * the one-line summary/prompt row each view draws above its list.
 */
export const enviTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
  },
});

export default enviTheme;

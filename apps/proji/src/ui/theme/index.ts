import { createTheme } from '@/dev-tools/ui/theme';

/** List-beside-detail minimums, plus the two rows the Commands tab draws above its list. */
export const projiTheme = createTheme({
  sizes: {
    app: { minWidth: 72, minHeight: 18 },
  },
  chrome: {
    viewHeader: 1,
    chipRow: 1,
  },
});

export default projiTheme;

import { createTheme } from '@/dev-tools/ui/theme';

/** depli's sizes over the stock tables: a list of targets beside their checks. */
export const depliTheme = createTheme({
  sizes: {
    app: { minWidth: 64, minHeight: 16 },
  },
});

export default depliTheme;

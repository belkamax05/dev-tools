import type { ThemeColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** What each porcelain status letter means, spelled out. */
export const STATUS_LABEL: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-change',
  U: 'unmerged',
  '?': 'untracked',
};

/**
 * The theme role a status letter is drawn in.
 *
 * A role rather than a colour, so the status list follows whichever palette is
 * on. The mapping is the obvious one — a deletion and an unresolved merge are
 * the two that cost you work if you miss them, so they take `error`; an addition
 * is the one unambiguously good outcome, so it takes `ok`.
 */
export const statusColor = (code: string, colors: ThemeColors): string => {
  switch (code) {
    case 'A':
      return colors.ok;
    case 'M':
    case 'T':
      return colors.warn;
    case 'D':
    case 'U':
      return colors.error;
    case 'R':
    case 'C':
      return colors.highlight;
    default:
      return colors.muted;
  }
};

/**
 * A path shortened from the left, keeping the filename.
 *
 * From the left because the end of a path is the part that identifies it: ten
 * files under the same deep directory truncated from the right are ten identical
 * rows.
 */
export const shortenPath = (path: string, max: number): string =>
  path.length <= max ? path : `…${path.slice(-(max - 1))}`;

import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type { Handoff };

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/**
 * What the dashboard keeps across a handoff (an editor opened on a list) and across tab
 * switches: the row each tab's cursor was on, the search, and the tag the Bookmarks tab is
 * narrowed to — set from the Tags tab.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  query: string;
  /** A tag's key, or undefined for every page. */
  tag?: string;
}

import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type { Handoff };

import type { Tone } from '@/dev-tools/ui/components/StatusNote';

export type { Tone };

/**
 * What the dashboard keeps across a handoff (an env file opened in the editor) and across tab
 * switches: the row each tab's cursor was on, each tab's search, and the folded locations.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  search: Record<string, string>;
  /** Locations folded in the Locations tab, by layer id. */
  collapsed: string[];
  /** Secrets drawn in full rather than masked — app-wide, saved in the state file. */
  reveal: boolean;
}

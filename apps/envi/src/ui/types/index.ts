import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type { Handoff };

import type { Tone } from '@/dev-tools/ui/components/StatusNote';

export type { Tone };

/**
 * What the dashboard keeps across a handoff (an env file opened in the editor) and across tab
 * switches: the row each tab's cursor was on and each tab's search.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  search: Record<string, string>;
  /** Secrets drawn in full rather than masked. Never saved — it resets with every run. */
  reveal: boolean;
}

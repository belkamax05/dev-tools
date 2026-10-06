import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type { Handoff };

import type { Tone } from '@/dev-tools/ui/components/StatusNote';

export type { Tone };

/**
 * What the dashboard keeps across a handoff (an editor opened on the config) and across tab
 * switches: the row each tab's cursor was on and the Listening tab's filter.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  filter: string;
}

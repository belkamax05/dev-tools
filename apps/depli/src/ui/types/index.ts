import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';

export type { Handoff };

import type { Tone } from '@/dev-tools/ui/components/StatusNote';

export type { Tone };

/** What the dashboard keeps across a handoff and across tab switches. */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
}

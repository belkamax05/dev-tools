import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';
import type { Tone } from '@/dev-tools/ui/components/StatusNote';

import type { ShowId } from '../../config/settings';

export type { Handoff, Tone };

/**
 * What the dashboard keeps across a handoff (it is remounted after every command it runs): the
 * tab, the group being looked at, the row each place had selected, the filter and the show chip.
 */
export interface Session {
  tab: string;
  /** Names of the groups descended into, outermost first. */
  path: string[];
  selected: Record<string, string | undefined>;
  filter: string;
  show: ShowId;
}

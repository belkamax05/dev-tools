import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';
import type { Scope, SortKey } from '../../core/processes';

export type { Handoff };

export type Tone = 'ok' | 'warn' | 'error' | 'info';

/**
 * What the dashboard keeps across a handoff and across tab switches: the row each tab's cursor
 * was on, the filter, and the scope and sort — shared by both process tabs, so switching between
 * the flat list and the tree keeps looking at the same processes.
 */
export interface Session {
  tab: string;
  selected: Record<string, string | undefined>;
  filter: string;
  scope: Scope;
  sort: SortKey;
}

import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { SCOPES, type Scope, SORT_KEYS, type SortKey } from '../../core/processes';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['processes', 'tree', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Seconds between re-reads of the process table; 0 switches them off. */
export const REFRESH_CHOICES = [0, 1, 2, 5, 10] as const;
export const DEFAULT_REFRESH_SECONDS = 2;

export interface ProcessiConfig {
  theme: string;
  refreshSeconds: number;
}

export interface ProcessiState {
  tab: TabId;
  sort: SortKey;
  scope: Scope;
}

/**
 * `~/.config/processi/config.json`: what a person chose — the theme and the refresh rate. Fine to
 * keep in dotfiles.
 */
export const configStore = createConfigStore<ProcessiConfig>({
  appName: 'processi',
  defaults: { theme: 'classic', refreshSeconds: DEFAULT_REFRESH_SECONDS },
});

/**
 * `~/.local/state/processi/state.json`: what processi remembers by itself — the tab, the sort
 * column and whose processes were shown — so the next run opens the way the last one was left.
 */
export const stateStore = createConfigStore<ProcessiState>({
  appName: 'processi',
  kind: 'state',
  defaults: { tab: 'processes', sort: 'cpu', scope: 'all' },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
    sort: SORT_KEYS.includes(raw.sort as SortKey) ? (raw.sort as SortKey) : defaults.sort,
    scope: SCOPES.includes(raw.scope as Scope) ? (raw.scope as Scope) : defaults.scope,
  }),
});

import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['targets', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface DepliConfig {
  theme: string;
}

export interface DepliState {
  tab: TabId;
}

/** `~/.config/depli/config.json`: what a person chose — the theme. Fine to keep in dotfiles. */
export const configStore = createConfigStore<DepliConfig>({
  appName: 'depli',
  defaults: { theme: 'classic' },
});

/** `~/.local/state/depli/state.json`: the last tab, so the next run opens where this one was left. */
export const stateStore = createConfigStore<DepliState>({
  appName: 'depli',
  kind: 'state',
  defaults: { tab: 'targets' },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
  }),
});

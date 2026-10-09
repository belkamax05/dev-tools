import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['commands', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

/** Which kinds of command the Commands tab lists. */
export const SHOW_IDS = ['all', 'override', 'alias', 'script'] as const;
export type ShowId = (typeof SHOW_IDS)[number];

export interface ProjiSettings {
  theme: string;
}

export interface ProjiState {
  tab: TabId;
  show: ShowId;
}

/** `~/.config/proji/config.json`: what a person chose — the theme. Fine to keep in dotfiles. */
export const configStore = createConfigStore<ProjiSettings>({
  appName: 'proji',
  defaults: { theme: 'classic' },
});

/** `~/.local/state/proji/state.json`: the tab and the "show" filter, as the last run left them. */
export const stateStore = createConfigStore<ProjiState>({
  appName: 'proji',
  kind: 'state',
  defaults: { tab: 'commands', show: 'all' },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
    show: SHOW_IDS.includes(raw.show as ShowId) ? (raw.show as ShowId) : defaults.show,
  }),
});

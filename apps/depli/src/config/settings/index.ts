import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import type { BranchSelection } from '../../core/branch';
import type { ConnectionPreference } from '../../core/plugin';

/** The dashboard's tabs, in order — also what `tab` in the state file may hold. */
export const TAB_IDS = ['chain', 'connections', 'settings'] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface DepliConfig {
  theme: string;
}

/** What one project (keyed by its folder) remembers: the env and the branch pick. */
export interface ProjectState extends BranchSelection {
  timingsExpanded?: boolean;
  otherRunsExpanded?: Record<string, boolean>;
  env?: string;
  /** Per provider: the transport pinned, the SSH key picked — set in the Connections tab. */
  connections?: Record<string, ConnectionPreference>;
}

export interface DepliState {
  tab: TabId;
  /** Keyed by folder, or `folder#flow` for each flow of a multi-flow config. */
  projects: Record<string, ProjectState>;
  /** Per project folder: the flow last switched to (`f`). */
  flows: Record<string, string>;
}

/** `~/.config/depli/config.json`: what a person chose — the theme. Fine to keep in dotfiles. */
export const configStore = createConfigStore<DepliConfig>({
  appName: 'depli',
  defaults: { theme: 'sakura' },
});

/**
 * `~/.local/state/depli/state.json`: the last tab, and per project the env and the branch picked
 * (with the branch the checkout was on then, so a checkout switch drops the pick).
 */
export const stateStore = createConfigStore<DepliState>({
  appName: 'depli',
  kind: 'state',
  defaults: { tab: 'chain', projects: {}, flows: {} },
  coerce: (raw, defaults) => ({
    tab: TAB_IDS.includes(raw.tab as TabId) ? (raw.tab as TabId) : defaults.tab,
    projects:
      raw.projects && typeof raw.projects === 'object'
        ? (raw.projects as Record<string, ProjectState>)
        : {},
    flows:
      raw.flows && typeof raw.flows === 'object' ? (raw.flows as Record<string, string>) : {},
  }),
});

// Branch/env and tab updates share one file: each must read after the previous write finishes.
let pendingStateSave: Promise<void> = Promise.resolve();
export const updateState = (update: (state: DepliState) => DepliState): Promise<void> => {
  const saving = pendingStateSave.then(async () => {
    await stateStore.save(update(await stateStore.load()));
  });
  pendingStateSave = saving.catch(() => {});
  return saving;
};

export const flushState = (): Promise<void> => pendingStateSave;

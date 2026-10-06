import { basename } from 'node:path';
import { useApp } from 'ink';
import { useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';

import {
  configStore,
  type ProcessiConfig,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import processiTheme from '../theme';
import type { Handoff, Session } from '../types';
import ProcessesView from '../views/ProcessesView';
import SettingsView from '../views/SettingsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'processes', icon: '📋', label: '📋 Processes' },
  { id: 'tree', icon: '🌳', label: '🌳 Tree' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  /** The folder processi was started in — what the "This folder" scope means. */
  root: string;
  config: ProcessiConfig;
  configPath: string;
  session: Session;
  notice?: string;
  onConfigChange: (config: ProcessiConfig) => void;
  /** The tab, scope or sort changed — the session already holds the new values. */
  onStateChange: () => void;
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}


/**
 * processi's dashboard: the process table as a list and as a tree, the way btop shows it, with
 * the ways to stop what is in it.
 */
export const App = ({
  root,
  config: initialConfig,
  configPath,
  session,
  notice,
  onConfigChange,
  onStateChange,
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'processes',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify, setStatus } = useStatus(notice);
  const [paused, setPaused] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);


  const updateConfig = (next: ProcessiConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onStateChange();
  };

  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setStatus(undefined);
  };

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: refresh,
      tooltip: 'Re-read the process table now',
    },
    {
      id: 'pause',
      label: paused ? 'Resume' : 'Pause',
      hotkey: 'P',
      isOn: paused,
      onPress: () => setPaused((was) => !was),
      tooltip: paused ? 'Start refreshing on the timer again' : 'Freeze the list where it is',
    },
  ];

  const refreshNote =
    paused || config.refreshSeconds <= 0 ? 'paused' : `every ${config.refreshSeconds}s`;

  const viewProps = {
    root,
    session,
    notify,
    refreshKey,
    refreshSeconds: paused ? 0 : config.refreshSeconds,
    onStateChange,
    onCaptureInput: setIsInputCaptured,
  };

  return (
    <AppShell
      title="processi"
      detail={`${basename(root) || root} · ${refreshNote}`}
      status={status}
      note={root}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={processiTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[r] refresh · [P] pause"
      footerActions={footerActions}
    >
      {tab === 'processes' && <ProcessesView key="flat" tree={false} {...viewProps} />}
      {tab === 'tree' && <ProcessesView key="tree" tree {...viewProps} />}
      {tab === 'settings' && (
        <SettingsView
          config={config}
          configPath={configPath}
          session={session}
          onConfigChange={updateConfig}
          onEditConfig={() => {
            onHandoff({ type: 'edit', path: configPath });
            exit();
          }}
          onCaptureInput={setIsInputCaptured}
          clearTargets={[
            { id: 'config', label: 'Settings', store: configStore, detail: 'theme, refresh rate' },
            { id: 'state', label: 'State', store: stateStore, detail: 'last tab, sort, scope' },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch or sort would write the state
            //? file straight back from what is still in memory
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;

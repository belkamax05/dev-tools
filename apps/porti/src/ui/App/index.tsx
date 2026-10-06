import { useApp } from 'ink';
import { useEffect, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';

import {
  configStore,
  type PortiConfig,
  stateStore,
  TAB_IDS,
  type TabId,
  type WatchedPort,
} from '../../config/settings';
import { mergeWatched } from '../../config/project';
import { getPortStatuses, isBusy } from '../../core/ports';
import portiTheme from '../theme';
import type { Handoff, Session } from '../types';
import PortsView from '../views/PortsView';
import SettingsView from '../views/SettingsView';

/**
 * The tabs. Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`:
 * a glyph Ink and the terminal measure differently shifts every border after it by a column.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'watched', icon: '🎯', label: '🎯 Watched' },
  { id: 'listening', icon: '📡', label: '📡 Listening' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  config: PortiConfig;
  /** Ports the project's `porti.config.ts` lists — watched too, but never saved into `config`. */
  projectPorts?: WatchedPort[];
  configPath: string;
  session: Session;
  notice?: string;
  onConfigChange: (config: PortiConfig) => void;
  onTabChange: (tab: TabId) => void;
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}



/**
 * porti's dashboard: the watched ports, every listening port, and the settings that decide which
 * ports are watched.
 *
 * One snapshot of the socket and process tables serves both port tabs, re-read on a timer the
 * way btop re-reads its process list — the timer pauses while a question is on screen, so the row
 * a confirmation is about cannot change under it.
 */
export const App = ({
  config: initialConfig,
  projectPorts = [],
  configPath,
  session,
  notice,
  onConfigChange,
  onTabChange,
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'watched',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify, setStatus } = useStatus(notice);
  const [paused, setPaused] = useState(false);

  const watched = mergeWatched(config.ports, projectPorts);
  const snapshot = useLoader(
    () => getPortStatuses(watched, { all: true }),
    [watched.map((entry) => `${entry.port}:${entry.name ?? ''}`).join(',')],
  );
  const { reload } = snapshot;

  useEffect(() => {
    if (config.refreshSeconds <= 0 || paused || isInputCaptured) return;
    const id = setInterval(reload, config.refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [config.refreshSeconds, paused, isInputCaptured, reload]);


  const updateConfig = (next: PortiConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onTabChange(next);
  };

  const refresh = () => {
    reload();
    setStatus(undefined);
  };

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: refresh,
      tooltip: 'Re-read the socket and process tables now',
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

  const statuses = snapshot.data ?? [];
  const busyWatched = statuses.filter((entry) => entry.watched && isBusy(entry)).length;
  const refreshNote =
    paused || config.refreshSeconds <= 0 ? 'paused' : `every ${config.refreshSeconds}s`;

  const viewProps = {
    statuses,
    isLoading: snapshot.isLoading,
    config,
    session,
    notify,
    reload,
    onConfigChange: updateConfig,
    onCaptureInput: setIsInputCaptured,
  };

  return (
    <AppShell
      title="porti"
      detail={`${watched.length} watched · ${busyWatched} busy · ${refreshNote}`}
      status={status}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={portiTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[r] refresh · [P] pause"
      footerActions={footerActions}
    >
      {tab === 'watched' && <PortsView key="watched" mode="watched" {...viewProps} />}
      {tab === 'listening' && <PortsView key="listening" mode="listening" {...viewProps} />}
      {tab === 'settings' && (
        <SettingsView
          config={config}
          configPath={configPath}
          session={session}
          notify={notify}
          onConfigChange={updateConfig}
          onCaptureInput={setIsInputCaptured}
          onEditConfig={() => {
            onHandoff({ type: 'edit', path: configPath });
            exit();
          }}
          clearTargets={[
            {
              id: 'config',
              label: 'Settings',
              store: configStore,
              detail: 'theme, refresh rate, watched ports',
            },
            { id: 'state', label: 'State', store: stateStore, detail: 'last tab' },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch or setting would write the
            //? files straight back from what is still in memory
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;

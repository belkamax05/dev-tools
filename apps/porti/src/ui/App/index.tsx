import { Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

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
import type { Handoff, Session, Tone } from '../types';
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

const toneColor = (colors: ReturnType<typeof useColors>, tone: Tone) =>
  tone === 'ok'
    ? colors.ok
    : tone === 'warn'
      ? colors.warn
      : tone === 'error'
        ? colors.error
        : colors.muted;

const StatusNote = ({ text, tone }: { text: string; tone: Tone }) => {
  const colors = useColors();
  return (
    <Text color={toneColor(colors, tone)} wrap="truncate">
      {text}
    </Text>
  );
};

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
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(
    notice ? { text: notice, tone: 'info' } : undefined,
  );
  const [footerHint, setFooterHint] = useState<string | null>(null);
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

  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);

  const updateConfig = (next: PortiConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onTabChange(next);
  };

  const cycleTheme = () =>
    updateConfig({ ...config, theme: nextThemeId(config.theme, 1, portiTheme.palettes) });

  const refresh = () => {
    reload();
    setStatus(undefined);
  };

  useInput(
    (input) => {
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T') cycleTheme();
      else if (input === 'P') setPaused((was) => !was);
    },
    { isActive: !isInputCaptured },
  );

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
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: cycleTheme,
      tooltip: 'Step to the next colour theme',
    },
    { id: 'quit', label: 'Quit', hotkey: 'q', onPress: exit, tooltip: 'Close porti' },
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
      note={status ? <StatusNote text={status.text} tone={status.tone} /> : undefined}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={portiTheme}
      palette={config.theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ??
        `[1-${TABS.length}] / Tab switch tab · [r] refresh · [P] pause · [t] theme · [q] quit`
      }
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
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

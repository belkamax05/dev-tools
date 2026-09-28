import { basename } from 'node:path';
import { Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

import {
  configStore,
  type ProcessiConfig,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import processiTheme from '../theme';
import type { Handoff, Session, Tone } from '../types';
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

const StatusNote = ({ text, tone }: { text: string; tone: Tone }) => {
  const colors = useColors();
  const color =
    tone === 'ok'
      ? colors.ok
      : tone === 'warn'
        ? colors.warn
        : tone === 'error'
          ? colors.error
          : colors.muted;
  return (
    <Text color={color} wrap="truncate">
      {text}
    </Text>
  );
};

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
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(
    notice ? { text: notice, tone: 'info' } : undefined,
  );
  const [footerHint, setFooterHint] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);

  const updateConfig = (next: ProcessiConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onStateChange();
  };

  const cycleTheme = () =>
    updateConfig({ ...config, theme: nextThemeId(config.theme, 1, processiTheme.palettes) });

  const refresh = () => {
    setRefreshKey((key) => key + 1);
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
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: cycleTheme,
      tooltip: 'Step to the next colour theme',
    },
    { id: 'quit', label: 'Quit', hotkey: 'q', onPress: exit, tooltip: 'Close processi' },
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
      note={status ? <StatusNote text={status.text} tone={status.tone} /> : root}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={processiTheme}
      palette={config.theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ??
        `[1-${TABS.length}] / Tab switch tab · [r] refresh · [P] pause · [t] theme · [q] quit`
      }
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
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

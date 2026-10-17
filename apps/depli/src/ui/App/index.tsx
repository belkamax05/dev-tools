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
  type DepliConfig,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import type { Target } from '../../core/registry';
import depliTheme from '../theme';
import type { Handoff, Session } from '../types';
import SettingsView from '../views/SettingsView';
import TargetsView from '../views/TargetsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'targets', icon: '🚀', label: '🚀 Targets' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  /** The project folder — where depli.config.ts was found, else the cwd. */
  root: string;
  projectPath?: string;
  projectError?: string;
  targets: Target[];
  config: DepliConfig;
  configPath: string;
  session: Session;
  notice?: string;
  onConfigChange: (config: DepliConfig) => void;
  /** The tab changed — the session already holds the new value. */
  onStateChange: () => void;
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}

/** depli's dashboard: the deploy targets this project has, whether each is ready, and a deploy. */
export const App = ({
  root,
  projectPath,
  projectError,
  targets,
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
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'targets',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify, setStatus } = useStatus(
    notice ?? (projectError ? `${projectPath}: ${projectError}` : undefined),
  );
  const [refreshKey, setRefreshKey] = useState(0);

  const updateConfig = (next: DepliConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onStateChange();
  };

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Recheck',
      hotkey: 'r',
      onPress: () => {
        setRefreshKey((key) => key + 1);
        setStatus(undefined);
      },
      tooltip: 'Run every target’s checks again',
    },
  ];

  return (
    <AppShell
      title="depli"
      detail={`${basename(root) || root} · ${targets.length} targets`}
      status={status}
      note={projectPath ?? `${root} (no depli.config.ts)`}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={depliTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[r] recheck"
      footerActions={footerActions}
    >
      {tab === 'targets' && (
        <TargetsView
          root={root}
          targets={targets}
          session={session}
          notify={notify}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          configPath={configPath}
          projectPath={projectPath}
          session={session}
          onEditFile={(path) => {
            onHandoff({ type: 'edit', path });
            exit();
          }}
          onCaptureInput={setIsInputCaptured}
          clearTargets={[
            { id: 'config', label: 'Settings', store: configStore, detail: 'theme' },
            { id: 'state', label: 'State', store: stateStore, detail: 'last tab' },
          ]}
          onCleared={(results) => {
            onCleared(results);
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;

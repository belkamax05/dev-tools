import { homedir } from 'node:os';
import { useApp } from 'ink';
import { useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';

import {
  configStore,
  type EnviConfig,
  stateStore,
  type TabId,
  toTabId,
} from '../../config/settings';
import { type Resolution, resolveEnv } from '../../core/resolve';
import enviTheme from '../theme';
import type { Handoff, Session, Tone } from '../types';
import useSecretPreview, { type Secrets } from '../useSecretPreview';
import LocationsView from '../views/LocationsView';
import SettingsView from '../views/SettingsView';
import ValuesView from '../views/ValuesView';

/**
 * The tabs. Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`:
 * a glyph Ink and the terminal measure differently shifts every border after it by a column.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'values', icon: '🧩', label: '🧩 Values' },
  { id: 'locations', icon: '📄', label: '📄 Locations' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  config: EnviConfig;
  cwd: string;
  configPath: string;
  session: Session;
  notice?: string;
  onConfigChange: (config: EnviConfig) => void;
  onTabChange: (tab: TabId) => void;
  /** [v] flipped — saved in the state file, so the next run opens the same way. */
  onRevealChange: (reveal: boolean) => void;
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}

/** Everything a view needs from the app, passed down whole. */
export interface ViewProps {
  resolution: Resolution | undefined;
  isLoading: boolean;
  config: EnviConfig;
  cwd: string;
  session: Session;
  /** Secrets drawn in full — [v] anywhere, for the whole app. */
  reveal: boolean;
  /** The app's 1Password reads, shared by every tab. */
  secrets: Secrets;
  /** [v] — flip the app-wide reveal, as the footer button does. */
  onToggleReveal: () => void;
  notify: (text: string, tone?: Tone) => void;
  reload: () => void;
  onConfigChange: (config: EnviConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  /** Hand the terminal to the editor on `path`; the dashboard comes back afterwards. */
  onEdit: (path: string) => void;
  /** Switch to `tab` with the row `selectedId` under its cursor — the same variable, seen there. */
  onJump: (tab: TabId, selectedId: string) => void;
}

const tilde = (path: string) => path.replace(homedir(), '~');

/**
 * envi's dashboard: every value here — envi's own, then the shell's — in one tab; the places those
 * values are kept (your vars, machine vars, the env files, env.config.ts) in another, where they
 * are edited and moved between places; and the settings deciding how they merge.
 *
 * One resolution serves every tab. It is re-read on [r], after every change made here and after
 * a handoff — not on a timer: nothing in it changes unless a file does.
 */
export const App = ({
  config: initialConfig,
  cwd,
  configPath,
  session,
  notice,
  onConfigChange,
  onTabChange,
  onRevealChange,
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(toTabId(session.tab) ?? 'values');
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify, setStatus } = useStatus(notice);
  const [reveal, setReveal] = useState(session.reveal);
  const secrets = useSecretPreview();

  //? Machine vars are re-read each time: `envi set --state` in another shell changes them
  const loader = useLoader(
    async () => resolveEnv({ cwd, config, stateVars: (await stateStore.load()).vars }),
    [JSON.stringify(config), cwd],
  );
  const { reload } = loader;

  const updateConfig = (next: EnviConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onTabChange(next);
  };

  const jump = (next: TabId, selectedId: string) => {
    session.selected[next] = selectedId;
    //? A search there could hide the row being jumped to
    session.search[next] = '';
    if (next === 'locations') {
      const location = selectedId.split('::')[0] ?? '';
      session.collapsed = session.collapsed.filter((id) => id !== location);
    }
    changeTab(next);
  };

  const toggleReveal = () => {
    const next = !reveal;
    setReveal(next);
    session.reveal = next;
    onRevealChange(next);
  };

  const refresh = () => {
    reload();
    setStatus(undefined);
  };

  const edit = (path: string) => {
    onHandoff({ type: 'edit', path });
    exit();
  };

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: refresh,
      tooltip: 'Re-read the env files and env.config.ts',
    },
    {
      id: 'reveal',
      label: reveal ? 'Hide secrets' : 'Reveal secrets',
      hotkey: 'v',
      isOn: reveal,
      onPress: toggleReveal,
      tooltip: reveal
        ? 'Mask secret values again, everywhere'
        : 'Show every secret in full, 1Password references read — kept until you hide them',
    },
  ];

  const resolution = loader.data;
  const changed = resolution?.vars.filter(
    (entry) => entry.status === 'new' || entry.status === 'changed',
  ).length;
  const missing = resolution?.missing.length ?? 0;
  const detail = resolution
    ? `${tilde(cwd)} · ${changed} set by envi${missing ? ` · ${missing} missing` : ''}${resolution.override ? ' · override' : ''}${reveal ? ' · secrets shown' : ''}`
    : tilde(cwd);

  const viewProps: ViewProps = {
    resolution,
    isLoading: loader.isLoading,
    config,
    cwd,
    session,
    reveal,
    secrets,
    onToggleReveal: toggleReveal,
    notify,
    reload,
    onConfigChange: updateConfig,
    onCaptureInput: setIsInputCaptured,
    onEdit: edit,
    onJump: jump,
  };

  return (
    <AppShell
      title="envi"
      detail={detail}
      status={status ?? (loader.error ? { text: String(loader.error), tone: 'error' } : undefined)}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={enviTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerActions={footerActions}
    >
      {tab === 'values' && <ValuesView {...viewProps} />}
      {tab === 'locations' && <LocationsView {...viewProps} />}
      {tab === 'settings' && (
        <SettingsView
          {...viewProps}
          configPath={configPath}
          clearTargets={[
            {
              id: 'config',
              label: 'Settings',
              store: configStore,
              detail: 'theme, file list, your vars, merge rules',
              //? Your vars may be the only copy of a token — never ticked by default
              checked: false,
            },
            {
              id: 'state',
              label: 'State',
              store: stateStore,
              detail: 'last tab, reveal, machine vars',
            },
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

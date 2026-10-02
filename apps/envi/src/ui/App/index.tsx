import { homedir } from 'node:os';
import { Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

import {
  configStore,
  type EnviConfig,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import { type Resolution, resolveEnv } from '../../core/resolve';
import enviTheme from '../theme';
import type { Handoff, Session, Tone } from '../types';
import FilesView from '../views/FilesView';
import ResolvedView from '../views/ResolvedView';
import SettingsView from '../views/SettingsView';
import ShellView from '../views/ShellView';
import VarsView from '../views/VarsView';

/**
 * The tabs. Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`:
 * a glyph Ink and the terminal measure differently shifts every border after it by a column.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'shell', icon: '🐚', label: '🐚 Shell' },
  { id: 'resolved', icon: '🧩', label: '🧩 Resolved' },
  { id: 'files', icon: '📄', label: '📄 Files' },
  { id: 'vars', icon: '👤', label: '👤 Your vars' },
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
  /** Secrets drawn in full — [v] anywhere. */
  reveal: boolean;
  notify: (text: string, tone?: Tone) => void;
  reload: () => void;
  onConfigChange: (config: EnviConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  /** Hand the terminal to the editor on `path`; the dashboard comes back afterwards. */
  onEdit: (path: string) => void;
}

const toneColor = (colors: ReturnType<typeof useColors>, tone: Tone) =>
  tone === 'ok'
    ? colors.ok
    : tone === 'warn'
      ? colors.warn
      : tone === 'error'
        ? colors.error
        : colors.muted;

const tilde = (path: string) => path.replace(homedir(), '~');

/** Its own component so `useColors` runs inside the theme `AppShell` provides. */
const StatusNote = ({ text, tone }: { text: string; tone: Tone }) => {
  const colors = useColors();
  return (
    <Text color={toneColor(colors, tone)} wrap="truncate">
      {text}
    </Text>
  );
};

/**
 * envi's dashboard: the shell's variables, what envi resolves on top of them and why, the env
 * files it reads, your own variables, and the settings deciding how they merge.
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
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'resolved',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(
    notice ? { text: notice, tone: 'info' } : undefined,
  );
  const [footerHint, setFooterHint] = useState<string | null>(null);
  const [reveal, setReveal] = useState(session.reveal);

  const loader = useLoader(() => resolveEnv({ cwd, config }), [JSON.stringify(config), cwd]);
  const { reload } = loader;

  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);

  const updateConfig = (next: EnviConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onTabChange(next);
  };

  const cycleTheme = () =>
    updateConfig({
      ...config,
      theme: nextThemeId(config.theme, 1, enviTheme.palettes),
    });

  const toggleReveal = () =>
    setReveal((was) => {
      session.reveal = !was;
      return !was;
    });

  const refresh = () => {
    reload();
    setStatus(undefined);
  };

  const edit = (path: string) => {
    onHandoff({ type: 'edit', path });
    exit();
  };

  useInput(
    (input) => {
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T') cycleTheme();
      else if (input === 'v' || input === 'V') toggleReveal();
    },
    { isActive: !isInputCaptured },
  );

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
      label: reveal ? 'Hide secrets' : 'Reveal',
      hotkey: 'v',
      isOn: reveal,
      onPress: toggleReveal,
      tooltip: reveal
        ? 'Mask secret-looking values again'
        : 'Show secret-looking values (tokens, passwords) in full',
    },
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: cycleTheme,
      tooltip: 'Step to the next colour theme',
    },
    {
      id: 'quit',
      label: 'Quit',
      hotkey: 'q',
      onPress: exit,
      tooltip: 'Close envi',
    },
  ];

  const resolution = loader.data;
  const changed = resolution?.vars.filter(
    (entry) => entry.status === 'new' || entry.status === 'changed',
  ).length;
  const missing = resolution?.missing.length ?? 0;
  const detail = resolution
    ? `${tilde(cwd)} · ${changed} set by envi${missing ? ` · ${missing} missing` : ''}${resolution.override ? ' · override' : ''}`
    : tilde(cwd);

  const viewProps: ViewProps = {
    resolution,
    isLoading: loader.isLoading,
    config,
    cwd,
    session,
    reveal,
    notify,
    reload,
    onConfigChange: updateConfig,
    onCaptureInput: setIsInputCaptured,
    onEdit: edit,
  };

  return (
    <AppShell
      title="envi"
      detail={detail}
      note={
        status ? (
          <StatusNote text={status.text} tone={status.tone} />
        ) : loader.error ? (
          <StatusNote text={String(loader.error)} tone="error" />
        ) : undefined
      }
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={enviTheme}
      palette={config.theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ??
        `[1-${TABS.length}] / Tab switch tab · [r] refresh · [v] reveal · [t] theme · [q] quit`
      }
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
    >
      {tab === 'shell' && <ShellView {...viewProps} />}
      {tab === 'resolved' && <ResolvedView {...viewProps} />}
      {tab === 'files' && <FilesView {...viewProps} />}
      {tab === 'vars' && <VarsView {...viewProps} />}
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
              detail: 'last tab',
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

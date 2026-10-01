import { basename } from 'node:path';
import { Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';

import {
  type FolderContext,
  type FolderState,
  resolveSettings,
  TAB_IDS,
  type TabId,
  userConfigStore,
  userStateStore,
  writeFolderState,
} from '../../config/settings';
import type { DetectedManager } from '../../core/manifest';
import pkgiTheme from '../theme';
import type { Session, Tone } from '../types';
import AddView from '../views/AddView';
import CompareView from '../views/CompareView';
import PackagesView from '../views/PackagesView';
import ScriptsView from '../views/ScriptsView';
import SettingsView from '../views/SettingsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'packages', icon: '📦', label: '📦 Packages' },
  { id: 'scripts', icon: '📜', label: '📜 Scripts' },
  { id: 'compare', icon: '🔀', label: '🔀 Compare' },
  { id: 'add', icon: '🔍', label: '🔍 Add' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  dir: string;
  context: FolderContext;
  manager: DetectedManager;
  theme: string;
  session: Session;
  notice?: { text: string; tone: Tone };
  onThemeChange: (theme: string) => void;
  onTabChange: (tab: TabId) => void;
  /** Keeps the session's copy current, so a handoff reopens on the state as last changed. */
  onContextChange: (context: FolderContext) => void;
  onRun: (commands: string[][], label: string, cwd?: string) => void;
  onEdit: (path: string) => void;
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
 * pkgi's dashboard: the packages of the folder it was started in — what is declared, installed
 * and available — beside other folders' for comparison, with the registry to add from.
 *
 * Every change to `package.json` is the package manager's to make: the dashboard hands it the
 * terminal (see `renderDashboard`), so its output, prompts and failures are the real ones.
 */
export const App = ({
  dir,
  context: initialContext,
  manager,
  theme: initialTheme,
  session,
  notice,
  onThemeChange,
  onTabChange,
  onContextChange,
  onRun,
  onEdit,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [context, setContext] = useState(initialContext);
  const [theme, setTheme] = useState(initialTheme);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'packages',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(notice);
  const [footerHint, setFooterHint] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const notify = useCallback((text: string, tone: Tone = 'info') => setStatus({ text, tone }), []);

  const updateState = useCallback(
    (mutate: (state: FolderState) => FolderState) => {
      setContext((current) => {
        const state = mutate(structuredClone(current.state));
        const next = {
          ...current,
          state,
          settings: resolveSettings(current.project.config, state),
        };
        onContextChange(next);
        writeFolderState(current.statePath, state).catch((error: Error) =>
          notify(`Could not save ${current.statePath}: ${error.message}`, 'error'),
        );
        return next;
      });
    },
    [notify, onContextChange],
  );

  const runCommands = useCallback(
    (commands: string[][], label: string, cwd?: string) => {
      onRun(commands, label, cwd);
      //? Unmount first: the package manager needs the real terminal, not the alternate screen
      exit();
    },
    [onRun, exit],
  );

  const edit = useCallback(
    (path: string) => {
      onEdit(path);
      exit();
    },
    [onEdit, exit],
  );

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onTabChange(next);
  };

  const changeTheme = (next: string) => {
    setTheme(next);
    onThemeChange(next);
  };

  const refresh = () => {
    setRefreshKey((key) => key + 1);
    setStatus(undefined);
  };

  useInput(
    (input) => {
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T')
        changeTheme(nextThemeId(theme, 1, pkgiTheme.palettes));
    },
    { isActive: !isInputCaptured },
  );

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: refresh,
      tooltip: 'Re-read package.json and node_modules',
    },
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: () => changeTheme(nextThemeId(theme, 1, pkgiTheme.palettes)),
      tooltip: 'Step to the next colour theme',
    },
    { id: 'quit', label: 'Quit', hotkey: 'q', onPress: exit, tooltip: 'Close pkgi' },
  ];

  const viewProps = {
    dir,
    context,
    manager,
    session,
    notify,
    onCaptureInput: setIsInputCaptured,
    runCommands,
    updateState,
    refreshKey,
  };

  const configNote = context.project.error
    ? { text: `pkgi.config ignored: ${context.project.error}`, tone: 'error' as Tone }
    : undefined;
  const shownStatus = status ?? configNote;

  return (
    <AppShell
      title={`pkgi — ${basename(dir) || dir}`}
      detail={`${manager.name}${context.project.path ? ' · pkgi.config.ts' : ''}`}
      note={shownStatus ? <StatusNote text={shownStatus.text} tone={shownStatus.tone} /> : dir}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={pkgiTheme}
      palette={theme}
      isInputCaptured={isInputCaptured}
      footerHints={
        footerHint ?? `[1-${TABS.length}] / Tab switch tab · [r] refresh · [t] theme · [q] quit`
      }
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
    >
      {tab === 'packages' && <PackagesView {...viewProps} />}
      {tab === 'scripts' && <ScriptsView {...viewProps} />}
      {tab === 'compare' && <CompareView {...viewProps} />}
      {tab === 'add' && <AddView {...viewProps} />}
      {tab === 'settings' && (
        <SettingsView
          {...viewProps}
          theme={theme}
          onThemeChange={changeTheme}
          onEdit={edit}
          clearTargets={[
            { id: 'config', label: 'Settings', store: userConfigStore, detail: 'theme' },
            { id: 'state', label: 'State', store: userStateStore, detail: 'last tab' },
            {
              id: 'folder',
              label: "This folder's notes & settings",
              //? The same file pkgi reads and writes, as a store, so it is cleared the way the
              //? other two are. Unticked by default: notes are the one thing here that cannot be
              //? recreated by using the app again.
              store: createConfigStore({ appName: 'pkgi', path: context.statePath, defaults: {} }),
              checked: false,
              detail: `${Object.keys(context.state.notes).length} note(s), compare folders, toggles`,
            },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch or note would write the files
            //? straight back from what is still in memory
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;

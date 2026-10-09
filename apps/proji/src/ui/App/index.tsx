import { basename } from 'node:path';
import { useApp } from 'ink';
import { useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useStatus from '@/dev-tools/ui/hooks/useStatus';

import {
  configStore,
  type ProjiSettings,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import type { ProjectOptions, ProjiCommand } from '../../core/project';
import projiTheme from '../theme';
import type { Handoff, Session } from '../types';
import CommandsView from '../views/CommandsView';
import SettingsView from '../views/SettingsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'commands', icon: '🚀', label: '🚀 Commands' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  options: ProjectOptions;
  commands: ProjiCommand[];
  settings: ProjiSettings;
  configPath: string;
  session: Session;
  notice?: string;
  onSettingsChange: (settings: ProjiSettings) => void;
  /** The tab or the show chip changed — the session already holds the new values. */
  onStateChange: () => void;
  onHandoff: (intent: Handoff) => void;
  /** A command with no command line was picked: run it once the dashboard has closed. */
  onRunInProcess: (command: ProjiCommand, args: string[]) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}

/** proji's dashboard: a project's commands, aliases and package.json scripts, ready to run. */
export const App = ({
  options,
  commands,
  settings: initialSettings,
  configPath,
  session,
  notice,
  onSettingsChange,
  onStateChange,
  onHandoff,
  onRunInProcess,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [settings, setSettings] = useState(initialSettings);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'commands',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const { status, notify } = useStatus(notice);

  const updateSettings = (next: ProjiSettings) => {
    setSettings(next);
    onSettingsChange(next);
  };

  const changeTab = (next: TabId) => {
    setTab(next);
    session.tab = next;
    onStateChange();
  };

  const prefix = options.commandPrefix ?? options.title;

  /** Hand the terminal to the command; the dashboard comes back when it exits. */
  const runCommand = (command: ProjiCommand, path: string[], args: string[]) => {
    const label = [prefix, ...path, ...args].join(' ');
    if (command.argv) {
      onHandoff({ type: 'run', command: command.argv(args), cwd: options.root, label });
    } else if (command.run) {
      onRunInProcess(command, args);
    } else {
      notify(`${label} has nothing to run`, 'warn');
      return;
    }
    exit();
  };

  const scripts = commands.filter((command) => command.source === 'script').length;

  return (
    <AppShell
      title={options.title}
      detail={`${basename(options.root) || options.root} · ${commands.length - scripts} commands · ${scripts} scripts`}
      status={status}
      note={options.root}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      theme={projiTheme}
      palette={settings.theme}
      onPaletteChange={(theme) => updateSettings({ ...settings, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[Enter] run · [a] run with args · [/] filter"
    >
      {tab === 'commands' && (
        <CommandsView
          commands={commands}
          prefix={prefix}
          session={session}
          notify={notify}
          onRun={runCommand}
          onStateChange={onStateChange}
          onCaptureInput={setIsInputCaptured}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          configPath={configPath}
          session={session}
          onEditConfig={() => {
            onHandoff({ type: 'edit', path: configPath });
            exit();
          }}
          onCaptureInput={setIsInputCaptured}
          clearTargets={[
            { id: 'config', label: 'Settings', store: configStore, detail: 'theme' },
            { id: 'state', label: 'State', store: stateStore, detail: 'last tab, show filter' },
          ]}
          onCleared={(results) => {
            onCleared(results);
            //? Quit rather than carry on: the next tab switch would write the state file back
            exit();
          }}
        />
      )}
    </AppShell>
  );
};

export default App;

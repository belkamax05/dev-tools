import { basename } from 'node:path';
import { type DOMElement, Text, useApp, useInput } from 'ink';
import { useRef, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import Box from '@/dev-tools/ui/components/Box';
import type { ClearResult } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import TuiThemeProvider, { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  configStore,
  type DepliConfig,
  flushState,
  stateStore,
  TAB_IDS,
  type TabId,
} from '../../config/settings';
import type { Session as DepliSession } from '../../core/session';
import depliTheme from '../theme';
import type { Handoff, Session } from '../types';
import useDepli, { type DepliData } from '../useDepli';
import BranchesView from '../views/BranchesView';
import ChainView from '../views/ChainView';
import ConnectionsView from '../views/ConnectionsView';
import EnvironmentsDetail from '../views/EnvironmentsDetail';
import EnvironmentsView from '../views/EnvironmentsView';
import SettingsView from '../views/SettingsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'chain', icon: '🚀', label: '🚀 Chain' },
  { id: 'connections', icon: '🔌', label: '🔌 Connections' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

/** A word in the status row that does something when clicked. */
const Clickable = ({
  children,
  color,
  onClick,
}: {
  children: string;
  color: string;
  onClick: () => void;
}) => {
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick });
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={color} inverse={isHovered}>
        {children}
      </Text>
    </Box>
  );
};

/**
 * Under the tabs, on every tab: each provider's connection (click: the Connections tab) and
 * whether triggers can fire at all. The branch and env have their own rows on the Chain tab.
 */
const StatusRow = ({
  data,
  providers,
  limited,
  triggers,
  onTab,
}: {
  data: DepliData;
  providers: string[];
  /** Providers connected over a transport that does less than another of theirs. */
  limited: string[];
  triggers: boolean;
  onTab: (tab: TabId) => void;
}) => {
  const colors = useColors();
  return (
    <Box flexDirection="row" flexShrink={0}>
      {providers.map((name) => {
        const connection = data.connections[name];
        const up = Boolean(connection?.transport);
        return (
          <Box key={name} marginRight={2} flexShrink={0}>
            <Clickable
              color={
                connection
                  ? up
                    ? limited.includes(name)
                      ? colors.warn
                      : colors.ok
                    : colors.error
                  : colors.muted
              }
              onClick={() => onTab('connections')}
            >
              {`${up ? '●' : '○'} ${name}${connection ? ` ${connection.transport ?? 'offline'}${connection.pinned ? ' (pinned)' : ''}${limited.includes(name) ? ' · limited' : ''}` : ' …'}`}
            </Clickable>
          </Box>
        );
      })}
      <Text color={triggers ? colors.error : colors.muted}>
        {triggers ? 'triggers ON' : 'dry run only'}
      </Text>
    </Box>
  );
};

export interface AppProps {
  depli: DepliSession;
  config: DepliConfig;
  configPath: string;
  session: Session;
  notice?: string;
  /** Open on the Environments window (`depli environments`) rather than the tab alone. */
  environments?: boolean;
  onConfigChange: (config: DepliConfig) => void;
  /** The tab changed — the session already holds the new value. */
  onStateChange: () => void;
  onHandoff: (intent: Handoff) => void;
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared: (results: ClearResult[]) => void;
}

/** depli's dashboard: the chain for a branch and env, every env, the branches, the connections. */
export const App = ({
  depli,
  config: initialConfig,
  configPath,
  session,
  notice,
  environments = false,
  onConfigChange,
  onStateChange,
  onHandoff,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const { project } = depli;
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'chain',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  //? The branch picker: the Chain tab's whole area while open — `filter` opens with the filter
  const [branchPicker, setBranchPicker] = useState(false);
  //? Bumped to open the Chain's environments panel from the status row
  const [envOpenRequest] = useState(0);
  //? The Environments window, over whichever tab is open (footer E), and its detailed view —
  //? the whole interface while open. Esc steps back: detailed → window → the tab
  const [envView, setEnvView] = useState<'closed' | 'window' | 'detailed'>(
    environments ? 'window' : 'closed',
  );
  const { status, notify, setStatus } = useStatus(notice ?? project.problems[0]);
  const data = useDepli(depli, notify);
  const envs = project.config.envs ?? [];
  const triggers = Boolean(project.config.triggers?.enabled);

  const updateConfig = (next: DepliConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
    setEnvView('closed');
    setTab(next);
    session.tab = next;
    onStateChange();
  };

  //? Everywhere: B is "back to the branch I have checked out"
  useInput(
    (input) => {
      if (input !== 'B') return;
      if (!data.current) return notify('No checkout branch to go back to', 'warn');
      data.resetBranch();
      notify(`Back on ${data.current}`, 'ok');
    },
    { isActive: !isInputCaptured && envView !== 'detailed' },
  );

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      onPress: () => {
        data.refresh();
        setStatus(undefined);
      },
      tooltip: 'Read the chain, the branches and the envs again',
    },
    envView === 'window'
      ? {
          id: 'environments',
          label: 'Open detailed',
          hotkey: 'E',
          onPress: () => setEnvView('detailed'),
          tooltip:
            'Every env in full: all jobs, every run by day, how they relate — over everything',
        }
      : {
          id: 'environments',
          label: 'Environments',
          hotkey: 'E',
          onPress: () => setEnvView('window'),
          tooltip: 'Every env: what it runs, what it should, its jobs and runs (Esc back)',
        },
  ];

  if (envView === 'detailed')
    return (
      <TuiThemeProvider theme={depliTheme} palette={config.theme}>
        <EnvironmentsDetail
          data={data}
          project={project}
          status={status}
          notify={notify}
          onClose={() => setEnvView('window')}
        />
      </TuiThemeProvider>
    );

  return (
    <AppShell
      title="depli"
      detail={`${basename(project.dir)}${data.current ? ` · checkout ${data.current}` : ''}`}
      status={status}
      note={depli.path ?? `${project.dir} (no depli.config.ts)`}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      underTabs={
        <StatusRow
          data={data}
          providers={project.providers.map((provider) => provider.name)}
          limited={project.providers
            .filter((provider) => {
              const used = provider.transports.find(
                (transport) => transport.id === data.connections[provider.name]?.transport,
              );
              return (
                used &&
                provider.transports.some((other) =>
                  other.capabilities.some((capability) => !used.capabilities.includes(capability)),
                )
              );
            })
            .map((provider) => provider.name)}
          triggers={triggers}
          onTab={changeTab}
        />
      }
      theme={depliTheme}
      palette={config.theme}
      onPaletteChange={(theme) => updateConfig({ ...config, theme })}
      isInputCaptured={isInputCaptured}
      footerHints="[r] refresh · [B] checkout branch"
      footerActions={footerActions}
    >
      {envView === 'window' && (
        <EnvironmentsView
          data={data}
          project={project}
          notify={notify}
          onClose={() => setEnvView('closed')}
        />
      )}
      {envView === 'closed' && tab === 'chain' && branchPicker && (
        <BranchesView
          data={data}
          watch={project.config.branches?.watch ?? []}
          recent={project.config.branches?.recent}
          session={session}
          onCaptureInput={setIsInputCaptured}
          onPicked={() => setBranchPicker(false)}
          onClose={() => setBranchPicker(false)}
        />
      )}
      {envView === 'closed' && tab === 'chain' && !branchPicker && (
        <ChainView
          data={data}
          envIds={envs.map((entry) => entry.id)}
          protectedEnvs={envs.filter((entry) => entry.protected).map((entry) => entry.id)}
          triggersEnabled={triggers}
          session={session}
          notify={notify}
          onCaptureInput={setIsInputCaptured}
          onPickBranch={() => setBranchPicker(true)}
          envOpenRequest={envOpenRequest}
        />
      )}
      {envView === 'closed' && tab === 'connections' && (
        <ConnectionsView
          data={data}
          providers={project.providers}
          problems={project.problems}
          session={session}
          notify={notify}
          onCaptureInput={setIsInputCaptured}
        />
      )}
      {envView === 'closed' && tab === 'settings' && (
        <SettingsView
          configPath={configPath}
          projectPath={depli.path}
          session={session}
          onEditFile={async (path) => {
            await flushState();
            onHandoff({ type: 'edit', path });
            exit();
          }}
          onCaptureInput={setIsInputCaptured}
          clearTargets={[
            { id: 'config', label: 'Settings', store: configStore, detail: 'theme' },
            {
              id: 'state',
              label: 'State',
              store: stateStore,
              detail: 'last tab, branch picks, envs, timings panel',
            },
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

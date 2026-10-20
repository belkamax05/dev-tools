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
import { type Session as DepliSession, nextFlow } from '../../core/session';
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
  flow,
  onSwitchFlow,
  providers,
  limited,
  triggers,
  onTab,
}: {
  data: DepliData;
  /** The flow open, of a multi-flow config — first on the row; a click switches to the next. */
  flow?: { label: string; next?: string };
  onSwitchFlow: () => void;
  providers: string[];
  /** Providers connected over a transport that does less than another of theirs. */
  limited: string[];
  triggers: boolean;
  onTab: (tab: TabId) => void;
}) => {
  const colors = useColors();
  return (
    <Box flexDirection="row" flexShrink={0}>
      {flow && (
        <Box marginRight={2} flexShrink={0}>
          <Clickable color={colors.accent} onClick={onSwitchFlow}>
            {`⇄ ${flow.label}${flow.next ? ` [f] → ${flow.next}` : ''}`}
          </Clickable>
        </Box>
      )}
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
  /** `f`: open another flow of a multi-flow config (`flows`) in place — no window. */
  onSwitchFlow?: (
    flow: string,
    intent?: { pickBranch?: boolean; returnTo?: string },
  ) => Promise<void>;
  /**
   * Why this flow was opened: to pick its branch (`F` from a flow that links it) — the picker
   * opens at once, and `returnTo` is opened again once a branch is picked or the picker closed.
   */
  flowIntent?: { pickBranch?: boolean; returnTo?: string };
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
  onSwitchFlow,
  flowIntent,
}: AppProps) => {
  const { exit } = useApp();
  const { project } = depli;
  const [config, setConfig] = useState(initialConfig);
  const [tab, setTab] = useState<TabId>(
    TAB_IDS.includes(session.tab as TabId) ? (session.tab as TabId) : 'chain',
  );
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  //? The branch picker: the Chain tab's whole area while open — `filter` opens with the filter
  const [branchPicker, setBranchPicker] = useState(Boolean(flowIntent?.pickBranch));
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

  //? fe ⇄ be: the other flow's config, in place — the App is mounted again on it
  const flowNext = nextFlow(project);
  const openFlow = (flow: string | undefined, intent?: AppProps['flowIntent']) => {
    if (!flow || !onSwitchFlow) return;
    notify(intent?.pickBranch ? `Opening ${flow} to pick its branch…` : `Switching to ${flow}…`);
    onSwitchFlow(flow, intent).catch((error: Error) =>
      notify(`Could not open ${flow}: ${error.message}`, 'error'),
    );
  };
  const switchFlow = () => openFlow(flowNext);
  //? F: change a linked branch (the FE branch, from the be flow) — its own flow's picker, then back
  const [firstLinked] = Object.values(project.linked ?? {});
  const pickLinked = (flow = firstLinked?.flow) =>
    openFlow(flow, { pickBranch: true, returnTo: project.flow?.id });
  //? Picked (or closed) a branch for the flow that sent us here: back to it
  const closeBranchPicker = () =>
    flowIntent?.returnTo ? openFlow(flowIntent.returnTo) : setBranchPicker(false);

  const footerActions: FooterAction[] = [
    ...(flowNext
      ? [
          {
            id: 'flow',
            label: `Flow: ${project.flow?.label}`,
            hotkey: 'f',
            onPress: switchFlow,
            tooltip: `Switch to the ${flowNext} flow — its own branches, envs and pipeline`,
          },
        ]
      : []),
    //? Its own button, so F is never taken as the flow button's capital
    ...(firstLinked
      ? [
          {
            id: 'linked-branch',
            label: firstLinked.label,
            hotkey: 'F',
            onPress: () => pickLinked(),
            tooltip: `Change the ${firstLinked.label}: ${firstLinked.flow}'s branch list, then back here`,
          },
        ]
      : []),
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
      detail={`${basename(project.dir)}${project.flow ? ` · ${project.flow.label}` : ''}${data.current ? ` · checkout ${data.current}` : ''}`}
      status={status}
      note={depli.path ?? `${project.dir} (no depli.config.ts)`}
      tabs={TABS}
      activeTab={tab}
      onTabChange={changeTab}
      underTabs={
        <StatusRow
          data={data}
          flow={project.flow && { label: project.flow.label, next: flowNext }}
          onSwitchFlow={switchFlow}
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
          custom={Boolean(project.config.branches?.custom)}
          source={project.config.branches?.provider ?? 'the provider'}
          session={session}
          onCaptureInput={setIsInputCaptured}
          onPicked={closeBranchPicker}
          onClose={closeBranchPicker}
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
          linked={Object.entries(project.linked ?? {}).map(([id, entry]) => ({ id, ...entry }))}
          onOpenFlow={(flow) => pickLinked(flow)}
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

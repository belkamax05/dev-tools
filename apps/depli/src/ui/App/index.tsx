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
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

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
import EnvsView from '../views/EnvsView';
import SettingsView from '../views/SettingsView';

/** Every icon is East Asian Width *Wide* with no U+FE0F selector — see `TabDefinition`. */
export const TABS: readonly TabDefinition<TabId>[] = [
  { id: 'chain', icon: '🚀', label: '🚀 Chain' },
  { id: 'envs', icon: '🌍', label: '🌍 Envs' },
  { id: 'branches', icon: '🌿', label: '🌿 Branches' },
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
 * Under the tabs, on every tab: each provider's connection (click: the Connections tab), the
 * branch and env (click: Branches / the Chain), and whether triggers can fire at all.
 */
const StatusRow = ({
  data,
  providers,
  triggers,
  onTab,
}: {
  data: DepliData;
  providers: string[];
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
              color={connection ? (up ? colors.ok : colors.error) : colors.muted}
              onClick={() => onTab('connections')}
            >
              {`${up ? '●' : '○'} ${name}${connection ? ` ${connection.transport ?? 'offline'}` : ' …'}`}
            </Clickable>
          </Box>
        );
      })}
      <Box marginRight={2} flexShrink={0}>
        <Clickable color={colors.text} onClick={() => onTab('branches')}>
          {`⎇ ${data.branch ?? '—'}`}
        </Clickable>
      </Box>
      <Box marginRight={2} flexShrink={0}>
        <Clickable color={colors.text} onClick={() => onTab('envs')}>
          {`→ ${data.targetEnv}`}
        </Clickable>
      </Box>
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
  const [filterOnArrival, setFilterOnArrival] = useState(false);
  const { status, notify, setStatus } = useStatus(
    notice ??
      (depli.reset
        ? `Checkout is on ${depli.current} — the earlier pick was reset to it`
        : undefined) ??
      project.problems[0],
  );
  const data = useDepli(depli, notify);
  const envs = project.config.envs ?? [];
  const triggers = Boolean(project.config.triggers?.enabled);

  const updateConfig = (next: DepliConfig) => {
    setConfig(next);
    onConfigChange(next);
  };

  const changeTab = (next: TabId) => {
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
    { isActive: !isInputCaptured },
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
  ];

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
      {tab === 'chain' && (
        <ChainView
          data={data}
          envIds={envs.map((entry) => entry.id)}
          protectedEnvs={envs.filter((entry) => entry.protected).map((entry) => entry.id)}
          triggersEnabled={triggers}
          session={session}
          notify={notify}
          onCaptureInput={setIsInputCaptured}
          onPickBranch={() => {
            setFilterOnArrival(true);
            changeTab('branches');
          }}
        />
      )}
      {tab === 'envs' && (
        <EnvsView
          data={data}
          session={session}
          onOpenEnv={(env) => {
            data.setEnv(env);
            changeTab('chain');
          }}
        />
      )}
      {tab === 'branches' && (
        <BranchesView
          data={data}
          watch={project.config.branches?.watch ?? []}
          session={session}
          startFiltering={filterOnArrival}
          onCaptureInput={(captured) => {
            setIsInputCaptured(captured);
            if (!captured) setFilterOnArrival(false);
          }}
          onPicked={() => changeTab('chain')}
        />
      )}
      {tab === 'connections' && (
        <ConnectionsView
          data={data}
          providers={project.providers}
          problems={project.problems}
          session={session}
        />
      )}
      {tab === 'settings' && (
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
              detail: 'last tab, branch picks, envs',
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

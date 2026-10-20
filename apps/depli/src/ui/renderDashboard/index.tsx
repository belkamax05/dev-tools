import { render } from 'ink';
import { useState } from 'react';

import { probeGraphicsSupport } from '@/dev-tools/terminal-canvas';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import {
  configStore,
  type DepliConfig,
  flushState,
  stateStore,
  type TabId,
  updateState,
} from '../../config/settings';
import { type Session as DepliSession, openSession, saveFlow, stateKey } from '../../core/session';
import App, { type AppProps } from '../App';
import type { Session } from '../types';

/**
 * The App for the flow open. `f` switches flow in place: the session is opened again for the
 * other flow and the App mounted afresh on it — its own branch, env and connections. `F` (a
 * linked branch) opens the other flow on its branch picker, and comes back once one is picked.
 */
const FlowHost = ({
  initial,
  onSwitched,
  ...props
}: Omit<AppProps, 'depli' | 'onSwitchFlow' | 'flowIntent'> & {
  initial: DepliSession;
  onSwitched: (depli: DepliSession) => void;
}) => {
  const [depli, setDepli] = useState(initial);
  const [intent, setIntent] = useState<AppProps['flowIntent']>();
  return (
    <App
      key={stateKey(depli.project)}
      {...props}
      depli={depli}
      flowIntent={intent}
      onSwitchFlow={async (flow, next) => {
        //? A pick made just before (the linked branch) must be saved before the flow reads it
        await flushState();
        const opened = await openSession(undefined, flow);
        //? A visit to pick a branch is not where the dashboard should open next time
        if (!next?.returnTo) await saveFlow(opened.project);
        props.session.selected = {};
        if (next?.pickBranch) props.session.tab = 'chain';
        onSwitched(opened);
        setIntent(next);
        setDepli(opened);
      }}
    />
  );
};

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * The project is read here and again after a handoff, so an edited depli.config.ts takes effect
 * on return.
 */
export const renderDashboard = async (
  initialTab?: TabId,
  { environments = false }: { environments?: boolean } = {},
): Promise<void> => {
  //? The probe reads replies from stdin, before Ink turns them into keypresses — then the
  //? graph, history strips and avatars draw with kitty / sixel / iTerm2, or as characters
  await probeGraphicsSupport();
  let [config, state, depli] = await Promise.all([
    configStore.load(),
    stateStore.load(),
    openSession(),
  ]);
  const session: Session = { tab: initialTab ?? state.tab, selected: {} };
  let cleared: string | undefined;
  let handedOff = false;

  await runTuiSession(
    (frame) => (
      <FlowHost
        initial={depli}
        //? Back from a handoff on the flow switched to, not the one started with
        onSwitched={(next) => {
          depli = next;
        }}
        config={config}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        //? Only the first frame: back from a handoff, the dashboard is where it was left
        environments={environments && !handedOff}
        onConfigChange={(next: DepliConfig) => {
          config = next;
          configStore.save(next).catch(() => {});
        }}
        onStateChange={() => {
          const tab = session.tab as TabId;
          updateState((saved) => ({ ...saved, tab })).catch(() => {});
        }}
        onHandoff={frame.handoff}
        onCleared={(results) => {
          cleared = describeClearResults(results);
        }}
      />
    ),
    {
      render,
      afterHandoff: async (intent) => {
        handedOff = true;
        if (intent.type === 'edit' && intent.path === stateStore.path) {
          state = await stateStore.load();
          session.tab = state.tab;
        }
        [config, depli] = await Promise.all([
          configStore.load(),
          openSession(undefined, depli.project.flow?.id),
        ]);
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  await flushState();
  if (cleared) console.log(`depli: ${cleared}`);
};

export default renderDashboard;

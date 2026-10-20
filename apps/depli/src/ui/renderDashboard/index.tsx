import { render } from 'ink';

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
import { openSession } from '../../core/session';
import App from '../App';
import type { Session } from '../types';

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
      <App
        depli={depli}
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
        [config, depli] = await Promise.all([configStore.load(), openSession()]);
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  await flushState();
  if (cleared) console.log(`depli: ${cleared}`);
};

export default renderDashboard;

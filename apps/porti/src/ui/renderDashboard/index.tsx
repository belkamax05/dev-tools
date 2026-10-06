import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import {
  configStore,
  type PortiConfig,
  stateStore,
  type TabId,
  type WatchedPort,
} from '../../config/settings';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * The only handoff is `e` in Settings — the config file in `$EDITOR` — which is why the config is
 * re-read after one: reopening with the copy from before the edit would undo it on the next save.
 */
export const renderDashboard = async (
  initialTab?: TabId,
  projectPorts: WatchedPort[] = [],
): Promise<void> => {
  let [config, state] = await Promise.all([configStore.load(), stateStore.load()]);
  const session: Session = { tab: initialTab ?? state.tab, selected: {}, filter: '' };
  let cleared: string | undefined;

  await runTuiSession(
    (frame) => (
      <App
        config={config}
        projectPorts={projectPorts}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        onConfigChange={(next: PortiConfig) => {
          config = next;
          //? Applied before it is saved, so a config dir that cannot be written costs
          //? persistence and not the setting
          configStore.save(next).catch(() => {});
        }}
        onTabChange={(tab) => {
          state = { ...state, tab };
          stateStore.save(state).catch(() => {});
        }}
        onHandoff={frame.handoff}
        onCleared={(results) => {
          cleared = describeClearResults(results);
        }}
      />
    ),
    {
      render,
      afterHandoff: async () => {
        config = await configStore.load();
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  if (cleared) console.log(`porti: ${cleared}`);
};

export default renderDashboard;

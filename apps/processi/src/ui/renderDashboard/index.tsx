import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import { configStore, type ProcessiConfig, stateStore, type TabId } from '../../config/settings';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * The directory processi was started in is fixed here, once: it is what the "This folder" scope
 * means for the whole session.
 */
export const renderDashboard = async (initialTab?: TabId): Promise<void> => {
  const root = process.cwd();
  let [config, state] = await Promise.all([configStore.load(), stateStore.load()]);
  const session: Session = {
    tab: initialTab ?? state.tab,
    selected: {},
    filter: '',
    scope: state.scope,
    sort: state.sort,
  };
  let cleared: string | undefined;

  await runTuiSession(
    (frame) => (
      <App
        root={root}
        config={config}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        onConfigChange={(next: ProcessiConfig) => {
          config = next;
          configStore.save(next).catch(() => {});
        }}
        onStateChange={() => {
          state = {
            tab: session.tab as TabId,
            scope: session.scope,
            sort: session.sort,
          };
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
  if (cleared) console.log(`processi: ${cleared}`);
};

export default renderDashboard;

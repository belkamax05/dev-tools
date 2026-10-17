import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import { loadProjectConfig } from '../../config/project';
import { configStore, type DepliConfig, stateStore, type TabId } from '../../config/settings';
import { resolveTargets } from '../../core/registry';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * The project is read once, here: the targets and the folder they deploy from are fixed for the
 * session, and re-read after a handoff (an edited depli.config.ts takes effect on return).
 */
export const renderDashboard = async (initialTab?: TabId): Promise<void> => {
  let [config, state, project] = await Promise.all([
    configStore.load(),
    stateStore.load(),
    loadProjectConfig(),
  ]);
  const session: Session = { tab: initialTab ?? state.tab, selected: {} };
  let cleared: string | undefined;

  await runTuiSession(
    (frame) => (
      <App
        root={project.dir}
        projectPath={project.path}
        projectError={project.error}
        targets={resolveTargets(project.config)}
        config={config}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        onConfigChange={(next: DepliConfig) => {
          config = next;
          configStore.save(next).catch(() => {});
        }}
        onStateChange={() => {
          state = { tab: session.tab as TabId };
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
        [config, project] = await Promise.all([configStore.load(), loadProjectConfig()]);
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  if (cleared) console.log(`depli: ${cleared}`);
};

export default renderDashboard;

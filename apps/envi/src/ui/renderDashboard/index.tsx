import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import {
  configStore,
  type EnviConfig,
  saveConfig,
  stateStore,
  type TabId,
  touchStamp,
} from '../../config/settings';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * A handoff is an env file, an `env.config.ts` or envi's own config opened in the editor, which
 * is why the config is re-read afterwards (reopening with the copy from before the edit would
 * undo it on the next save) and the stamp touched (so a hooked shell re-applies on its next
 * prompt).
 */
export const renderDashboard = async (
  initialTab: TabId | undefined,
  cwd: string,
): Promise<void> => {
  let [config, state] = await Promise.all([configStore.load(), stateStore.load()]);
  const session: Session = {
    tab: initialTab ?? state.tab,
    selected: {},
    search: {},
    reveal: false,
  };
  let cleared: string | undefined;

  await runTuiSession(
    (frame) => (
      <App
        config={config}
        cwd={cwd}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        onConfigChange={(next: EnviConfig) => {
          config = next;
          //? Applied before it is saved, so a config dir that cannot be written costs
          //? persistence and not the setting
          saveConfig(next).catch(() => {});
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
        await touchStamp();
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  if (cleared) console.log(`envi: ${cleared}`);
};

export default renderDashboard;

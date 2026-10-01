import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import { type BmiConfig, configStore, loadStaticList, type TabId } from '../../config/settings';
import { openPreviewCache } from '../../core/preview';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard, and keep reopening it after a handoff until the user quits.
 *
 * The only handoff is `e`/`E` in Settings — one of the two lists in `$EDITOR` — which is why both
 * are re-read after one: reopening with the copy from before the edit would undo it on the next
 * save.
 */
export const renderDashboard = async (initialTab?: TabId): Promise<void> => {
  let [config, staticList, cache] = await Promise.all([
    configStore.load(),
    loadStaticList(),
    openPreviewCache(),
  ]);
  const session: Session = {
    tab: initialTab ?? 'bookmarks',
    selected: {},
    query: '',
  };
  let cleared: string | undefined;

  const reload = async () => {
    [config, staticList] = await Promise.all([configStore.load(), loadStaticList()]);
    return { config, staticList };
  };

  await runTuiSession(
    (frame) => (
      <App
        config={config}
        staticList={staticList}
        cache={cache}
        session={session}
        notice={frame.notice}
        onConfigChange={(next: BmiConfig) => {
          config = next;
          //? Applied before it is saved, so a config dir that cannot be written costs
          //? persistence and not the edit
          configStore.save(next).catch(() => {});
        }}
        onHandoff={frame.handoff}
        onReload={reload}
        onCleared={(results) => {
          cleared = describeClearResults(results);
        }}
      />
    ),
    {
      render,
      afterHandoff: async () => {
        await reload();
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );
  if (cleared) console.log(`bmi: ${cleared}`);
};

export default renderDashboard;

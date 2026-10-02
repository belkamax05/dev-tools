import { render } from 'ink';

import { probeGraphicsSupport } from '@/dev-tools/terminal-canvas';
import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import { type BmiConfig, configStore, loadWorkspaceList, type TabId } from '../../config/settings';
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
  //? The probe reads replies from stdin, before Ink turns them into keypresses.
  //? Favicon rendering then chooses kitty, sixel, iTerm2, or half-blocks.
  await probeGraphicsSupport();
  let [config, workspaceList, cache] = await Promise.all([
    configStore.load(),
    loadWorkspaceList(),
    openPreviewCache(),
  ]);
  const session: Session = {
    tab: initialTab ?? 'bookmarks',
    selected: {},
    query: '',
  };
  let cleared: string | undefined;

  const reload = async () => {
    [config, workspaceList] = await Promise.all([configStore.load(), loadWorkspaceList()]);
    return { config, workspaceList };
  };

  await runTuiSession(
    (frame) => (
      <App
        config={config}
        workspaceList={workspaceList}
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

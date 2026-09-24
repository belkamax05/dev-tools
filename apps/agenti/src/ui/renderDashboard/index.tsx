import { relative } from 'node:path';
import { render } from 'ink';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';

import settingsStore, { hasOwnIde } from '../../config/settings';
import editFile from '../../utils/editFile';
import App, { type TabId } from '../App';
import type { Handoff, Session } from '../types';

/**
 * Open the dashboard on `root`, and keep reopening it until the user quits.
 *
 * The loop is how a tab gets an editor: it hands back what it wants done, the
 * dashboard unmounts and gives the terminal back, the editor runs on it, and
 * the dashboard comes back up on the same tab, row and open folders — all of
 * which live in `session` for exactly this reason.
 */
export const renderDashboard = async (root: string, initialTab?: TabId): Promise<void> => {
  let settings = await settingsStore.load();
  const session: Session = {
    //? A repo that has never picked an IDE opens on the picker, so the first
    //? thing anyone sees is the question every other tab depends on
    tab: initialTab ?? (hasOwnIde(settings, root) ? 'agents' : 'ide'),
    selected: {},
    expanded: new Set(['rules', 'skills', 'workflows']),
  };
  let notice: string | undefined;

  while (true) {
    let handoff: Handoff | undefined;

    await runTuiApp(
      <App
        root={root}
        settings={settings}
        settingsPath={settingsStore.path}
        session={session}
        notice={notice}
        onSettingsChange={(next) => {
          settings = next;
          //? Applied before it is saved, so a config dir that cannot be written
          //? costs persistence and not the setting
          settingsStore.save(next).catch(() => {});
        }}
        onHandoff={(intent) => {
          handoff = intent;
        }}
      />,
      { render, keepProcessAlive: true },
    );

    if (!handoff) return;
    editFile(handoff.path);
    notice = `Back from editing ${relative(root, handoff.path)}`;
  }
};

export default renderDashboard;

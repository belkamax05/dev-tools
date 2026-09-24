import { relative } from 'node:path';
import { render } from 'ink';

import { probeGraphicsSupport } from '@/dev-tools/terminal-canvas';
import runTuiSession from '@/dev-tools/ui/app/runTuiSession';

import settingsStore, { hasOwnIde, type TabId } from '../../config/settings';
import type { Scope } from '../../core/scope';
import App from '../App';
import type { Session } from '../types';

/**
 * Open the dashboard on a scope, and keep reopening it until the user quits.
 *
 * `runTuiSession` is what lets a tab borrow the terminal — for an editor, or to
 * launch Claude Code — and come back; everything worth returning to (the tab,
 * the selected row, the open folders) lives in `session` for that reason.
 */
export const renderDashboard = async (scope: Scope, initialTab?: TabId): Promise<void> => {
  const { root } = scope;
  //? Before Ink is handed stdin: the probe reads the terminal's replies off it,
  //? and once the TUI owns stdin a reply arrives as a burst of garbage keys
  await probeGraphicsSupport();
  let settings = await settingsStore.load();
  const session: Session = {
    //? `agenti mcp` means the MCP tab, whatever was open last time. Otherwise a
    //? repo that has never picked an IDE opens on the picker — the question
    //? every other tab depends on — and one that has opens where the user left off
    tab: initialTab ?? (hasOwnIde(settings, root) ? settings.lastTab : 'ide'),
    selected: {},
    expanded: new Set(['rules', 'skills', 'workflows']),
    preview: false,
    ideFocus: { pane: 'list', link: 0 },
  };

  await runTuiSession(
    (frame) => (
      <App
        scope={scope}
        settings={settings}
        settingsPath={settingsStore.path}
        session={session}
        notice={frame.notice}
        onSettingsChange={(next) => {
          settings = next;
          //? Applied before it is saved, so a config dir that cannot be written
          //? costs persistence and not the setting
          settingsStore.save(next).catch(() => {});
        }}
        onHandoff={frame.handoff}
      />
    ),
    {
      render,
      //? The file edited may have been agenti's own config — reopening with the
      //? copy from before the edit would undo it on the next save
      afterHandoff: async () => {
        settings = await settingsStore.load();
      },
      describe: (intent) =>
        intent.type === 'edit'
          ? `Back from editing ${relative(root, intent.path)}`
          : `Back from ${intent.label}`,
    },
  );
};

export default renderDashboard;

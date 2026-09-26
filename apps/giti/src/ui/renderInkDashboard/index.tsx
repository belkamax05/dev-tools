import { relative } from 'node:path';
import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import getCommandEntries from '../../utils/getCommandEntries';
import getCommandPickerItems from '../../utils/getCommandPickerItems';
import getWorkingDir from '../../utils/getWorkingDir';
import App, { TABS, type TabId } from '../dashboard/App';

/**
 * Open the giti dashboard and resolve with the command the user picked from
 * its palette, if any.
 *
 * Dispatching a picked command is left to `src/run.ts` — the name goes
 * back the way it came, so there is still one dispatch path, and the command
 * runs on a terminal the TUI has already handed back. Everything else — an
 * editor for a file or a commit message — is lent the terminal by
 * `runTuiSession` and the dashboard comes back on the same tab.
 *
 * @returns The picked command's name, or `undefined` when the user just quit
 */
const renderInkDashboard = async (): Promise<string | undefined> => {
  const cwd = getWorkingDir();
  const entries = await getCommandEntries();
  const commands = getCommandPickerItems(entries);

  const configStore = createConfigStore({
    appName: 'giti',
    defaults: { theme: 'classic', tab: 'overview' },
  });
  let config = await configStore.load();
  const save = (next: typeof config) => {
    config = next;
    configStore.save(next).catch(() => {});
  };
  //? Across handoffs the tab comes from here, so an editor round trip lands
  //? back where it left; across runs, from the saved config
  let tab: TabId = TABS.some((t) => t.id === config.tab) ? (config.tab as TabId) : 'overview';

  //? Written by the app on its way out and read once the session returns.
  let picked: string | undefined;

  await runTuiSession(
    (frame) => (
      <App
        cwd={cwd}
        commands={commands}
        notice={frame.notice}
        onHandoff={frame.handoff}
        initialTab={tab}
        onTabChange={(next) => {
          tab = next;
          save({ ...config, tab: next });
        }}
        initialPaletteId={config.theme}
        onThemeChange={(theme) => save({ ...config, theme })}
        onRunCommand={(command) => {
          picked = command;
        }}
      />
    ),
    {
      render,
      describe: (intent) =>
        intent.type === 'edit'
          ? `Back from editing ${relative(cwd, intent.path)}`
          : `Back from ${intent.label}`,
    },
  );

  return picked;
};

export default renderInkDashboard;

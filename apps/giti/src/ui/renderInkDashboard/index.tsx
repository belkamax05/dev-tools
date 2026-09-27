import { relative } from 'node:path';
import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import getCommandEntries from '../../utils/getCommandEntries';
import getCommandPickerItems from '../../utils/getCommandPickerItems';
import getWorkingDir from '../../utils/getWorkingDir';
import App, { TABS, type TabId } from '../dashboard/App';
import { DEFAULT_REFRESH_SECONDS } from '../dashboard/views/SettingsView';

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

  //? Settings and state are two files. `config.json` holds what a person chose (the theme) and
  //? is often a tracked dotfile — stow-linked into ~/.config/giti. The last tab is state: it
  //? changes on every run, so kept in the config it rewrote a tracked file each time. It lives
  //? in `state.json` under XDG_STATE_HOME (~/.local/state/giti) instead, which never sits in
  //? anyone's dotfiles — not even when stow links the whole ~/.config/giti directory.
  const configStore = createConfigStore({
    appName: 'giti',
    defaults: { theme: 'classic', refreshSeconds: DEFAULT_REFRESH_SECONDS },
  });
  const stateStore = createConfigStore({
    appName: 'giti',
    kind: 'state',
    //? `details`: whether Overview's `+` section was left open.
    defaults: { tab: 'overview', details: false },
  });
  const [config, state] = await Promise.all([configStore.load(), stateStore.load()]);
  //? Both saves are fire-and-forget: the setting is already applied on screen, so a directory
  //? that cannot be written costs persistence, not the change itself.
  const saveConfig = (next: Partial<typeof config>) => {
    Object.assign(config, next);
    configStore.save(config).catch(() => {});
  };
  const saveState = (next: Partial<typeof state>) => {
    Object.assign(state, next);
    stateStore.save(state).catch(() => {});
  };

  //? Across handoffs the tab comes from here, so an editor round trip lands
  //? back where it left; across runs, from the saved state
  //? `vendored` was its own tab before it joined Remotes
  const savedTab = state.tab === 'vendored' ? 'remotes' : state.tab;
  let tab: TabId = TABS.some((t) => t.id === savedTab) ? (savedTab as TabId) : 'overview';

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
          saveState({ tab: next });
        }}
        initialDetails={state.details}
        onDetailsChange={(details) => saveState({ details })}
        initialPaletteId={config.theme}
        onThemeChange={(theme) => saveConfig({ theme })}
        initialRefreshSeconds={config.refreshSeconds}
        onRefreshChange={(refreshSeconds) => saveConfig({ refreshSeconds })}
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

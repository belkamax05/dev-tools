import { render } from 'ink';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import getCommandEntries from '../../utils/getCommandEntries';
import getCommandPickerItems from '../../utils/getCommandPickerItems';
import getWorkingDir from '../../utils/getWorkingDir';
import App from '../dashboard/App';

/**
 * Open the giti dashboard and resolve with the command the user picked, if any.
 *
 * Dispatching is left to `src/cli/index.ts`, exactly as `renderInkCommands`
 * leaves it: the returned name is what the CLI resolves onto a file, so the
 * dashboard feeds the one dispatch path instead of growing a second one — and
 * the command runs on a terminal the TUI has already handed back, rather than
 * writing into an alternate screen that is about to be discarded.
 *
 * @returns The picked command's name, or `undefined` when the user just quit
 */
const renderInkDashboard = async (): Promise<string | undefined> => {
  const cwd = getWorkingDir();
  const entries = await getCommandEntries();
  const commands = getCommandPickerItems(entries);

  const configStore = createConfigStore({
    appName: 'giti',
    defaults: { theme: 'classic' },
  });
  const config = await configStore.load();

  //? Written by the app on its way out and read once `runTuiApp` returns. A
  //? plain variable rather than a promise because the ordering is already
  //? guaranteed: the app sets this and then calls `exit()`, and `runTuiApp` does
  //? not return until Ink has unmounted and the terminal is back.
  let picked: string | undefined;

  await runTuiApp(
    <App
      cwd={cwd}
      commands={commands}
      initialPaletteId={config.theme}
      onThemeChange={(theme) => {
        configStore.save({ ...config, theme }).catch(() => {});
      }}
      onRunCommand={(command) => {
        picked = command;
      }}
    />,
    {
      //? giti's own `render`, which is what keeps this usable from a repo that
      //? resolves its own ink — see the lib's `InkRender`.
      render,
      //? The whole point of returning a value: the process has to outlive the
      //? dashboard so the CLI can dispatch what was picked.
      keepProcessAlive: true,
    },
  );

  return picked;
};

export default renderInkDashboard;

import { render } from 'ink';

import runTuiSession from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import { configStore, type ProjiSettings, stateStore, type TabId } from '../../config/settings';
import { collectCommands, type ProjectOptions, type ProjiCommand } from '../../core/project';
import App from '../App';
import type { Session } from '../types';

export interface DashboardOptions extends ProjectOptions {
  /** Groups to open the Commands tab inside, outermost first (`dfs fe prod`). */
  initialPath?: string[];
}

/**
 * Open the dashboard over a project's commands, and keep reopening it after each command it runs
 * until the user quits. Resolves with the exit code to use.
 *
 * A command with a command line runs as a handoff: the terminal is the command's until it
 * exits, then the dashboard comes back. One that can only run in-process (an override with `run`
 * and no `command`) ends the session instead and runs once the dashboard is gone.
 */
export const renderDashboard = async ({
  initialPath = [],
  ...options
}: DashboardOptions): Promise<number> => {
  let [settings, state, commands] = await Promise.all([
    configStore.load(),
    stateStore.load(),
    collectCommands(options),
  ]);
  const session: Session = {
    tab: state.tab,
    path: initialPath,
    selected: {},
    filter: '',
    show: state.show,
  };
  let cleared: string | undefined;
  let inProcess: { command: ProjiCommand; args: string[] } | undefined;

  await runTuiSession(
    (frame) => (
      <App
        options={options}
        commands={commands}
        settings={settings}
        configPath={configStore.path}
        session={session}
        notice={frame.notice}
        onSettingsChange={(next: ProjiSettings) => {
          settings = next;
          configStore.save(next).catch(() => {});
        }}
        onStateChange={() => {
          state = { tab: session.tab as TabId, show: session.show };
          stateStore.save(state).catch(() => {});
        }}
        onHandoff={frame.handoff}
        onRunInProcess={(command, args) => {
          inProcess = { command, args };
        }}
        onCleared={(results) => {
          cleared = describeClearResults(results);
        }}
      />
    ),
    {
      render,
      //? A command may well have changed what there is to run (a new script, a renamed one)
      afterHandoff: async () => {
        [settings, commands] = await Promise.all([configStore.load(), collectCommands(options)]);
      },
      describe: (intent) =>
        intent.type === 'edit' ? `Back from editing ${intent.path}` : `Back from ${intent.label}`,
    },
  );

  if (cleared) console.log(`proji: ${cleared}`);
  return inProcess?.command.run ? inProcess.command.run(inProcess.args) : 0;
};

export default renderDashboard;

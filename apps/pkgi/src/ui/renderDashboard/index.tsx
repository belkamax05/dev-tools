import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { render } from 'ink';

import runTuiSession, { type Handoff } from '@/dev-tools/ui/app/runTuiSession';
import { describeClearResults } from '@/dev-tools/ui/components/ClearDataDialog';

import {
  loadFolderContext,
  type TabId,
  userConfigStore,
  userStateStore,
} from '../../config/settings';
import { detectPackageManager, shellQuote } from '../../core/manifest';
import { flushRegistryCache } from '../../core/registry';
import App from '../App';
import type { Session } from '../types';

/**
 * Wrap package-manager commands for the terminal: echo what runs, run it, record the exit code
 * where the dashboard can read it back, and wait for Enter — otherwise the output would flash
 * past before the dashboard redraws over it, and a failed install would look like a finished one.
 *
 * The commands and the status file travel as positional parameters, never spliced into the
 * script, so a package name cannot be read as shell.
 */
export const wrapCommands = (commands: string[][], statusFile: string): string[] => {
  const script = commands.map(shellQuote).join(' && ');
  return [
    'sh',
    '-c',
    [
      'printf "\\033[36m$ %s\\033[0m\\n\\n" "$1"',
      'eval "$1"',
      'code=$?',
      'echo "$code" > "$2"',
      'if [ "$code" = 0 ]; then printf "\\n\\033[32m✔ done\\033[0m"; else printf "\\n\\033[31m✖ exit %s\\033[0m" "$code"; fi',
      'printf " — Enter returns to pkgi "',
      'read _ < /dev/tty',
    ].join('; '),
    'pkgi',
    script,
    statusFile,
  ];
};

/**
 * Open the dashboard on a folder, and reopen it after every handoff — each package-manager command
 * and each file opened in `$EDITOR` — until the user quits.
 *
 * The folder's context (its `pkgi.config.ts` and state file) is re-read after each handoff: the
 * file edited may have been either of them, and an install changes what `package.json` declares.
 */
export const renderDashboard = async (dir: string, initialTab?: TabId): Promise<void> => {
  let context = await loadFolderContext(dir);
  let manager = await detectPackageManager(dir, context.settings.packageManager);
  let userConfig = await userConfigStore.load();
  let userState = await userStateStore.load();
  const statusFile = join(tmpdir(), `pkgi-${process.pid}.status`);
  let result: { text: string; tone: 'ok' | 'error' } | undefined;
  let cleared: string | undefined;

  const session: Session = {
    tab: initialTab ?? userState.tab,
    selected: {},
    filter: '',
    onlyOutdated: false,
    onlyDifferent: false,
  };

  await runTuiSession(
    (frame) => (
      <App
        dir={dir}
        context={context}
        manager={manager}
        theme={userConfig.theme}
        session={session}
        notice={result ?? (frame.notice ? { text: frame.notice, tone: 'info' } : undefined)}
        onThemeChange={(theme) => {
          userConfig = { ...userConfig, theme };
          userConfigStore.save(userConfig).catch(() => {});
        }}
        onTabChange={(tab) => {
          userState = { ...userState, tab };
          userStateStore.save(userState).catch(() => {});
        }}
        onContextChange={(next) => {
          context = next;
        }}
        onRun={(commands, label, cwd = dir) => {
          const intent: Handoff = {
            type: 'run',
            command: wrapCommands(commands, statusFile),
            cwd,
            label,
          };
          frame.handoff(intent);
        }}
        onEdit={(path) => frame.handoff({ type: 'edit', path })}
        onCleared={(results) => {
          cleared = describeClearResults(results);
        }}
      />
    ),
    {
      render,
      afterHandoff: async (intent) => {
        result = undefined;
        if (intent.type === 'run') {
          const code = (
            await Bun.file(statusFile)
              .text()
              .catch(() => '')
          ).trim();
          await rm(statusFile, { force: true });
          result =
            code === '0'
              ? { text: `✔ ${intent.label}`, tone: 'ok' }
              : { text: `✖ ${intent.label} failed${code ? ` (exit ${code})` : ''}`, tone: 'error' };
        }
        context = await loadFolderContext(dir);
        manager = await detectPackageManager(dir, context.settings.packageManager);
      },
      describe: (intent) =>
        intent.type === 'edit'
          ? `Back from editing ${relative(dir, intent.path).startsWith('..') ? intent.path : relative(dir, intent.path)}`
          : intent.label,
    },
  );
  await flushRegistryCache();
  if (cleared) console.log(`pkgi: ${cleared}`);
};

export default renderDashboard;

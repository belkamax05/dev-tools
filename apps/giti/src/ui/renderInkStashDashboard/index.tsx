import { render, Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import type { Tone } from '@/dev-tools/ui/components/StatusNote';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import {
  applyRemoteStash,
  getRemoteStashes,
  type RemoteStash,
  removeRemoteStash,
  saveRemoteStash,
} from '../../core/remoteStash';
import type { OperationResult } from '../../core/status';
import SpinnerGlyph from '../dashboard/SpinnerGlyph';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import { RemoteStashList, StashFilesStep } from '../renderInkRemoteStashes';
import { StashSaveForm } from '../renderInkStashSave';

export interface StashDashboardProps {
  cwd: string;
  remote: string;
}

type Screen = { kind: 'list' } | { kind: 'apply'; stash: RemoteStash } | { kind: 'save' };

/**
 * `giti stash`: the remote's stashes as giti's dashboard shows a repository — the list, the
 * selected stash's files and diff, and buttons that act on it in place:
 *
 * - Apply (Enter) opens its files as a checklist, then applies the ticked ones;
 * - Remove (`x`) asks, then deletes it from the remote for everyone;
 * - Save new (`s`) opens `stash save`'s screen over the list, and pushes what is picked there;
 * - Refresh (`r`) reads the remote again.
 *
 * Each action reports in the status line and comes back to the list; only Esc/q leaves.
 */
export const StashDashboard = ({ cwd, remote }: StashDashboardProps) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const height = Math.max(1, viewport.rows - useTuiTheme().sizes.app.heldBackRows);
  const [captured, setCaptured] = useState(false);
  const prompt = usePrompt(setCaptured, { inlineConfirm: true });
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [index, setIndex] = useState(true);
  const [current, setCurrent] = useState<RemoteStash>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ text: string; tone: Tone }>();
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((key) => key + 1);

  const {
    data: stashes = [],
    isLoading,
    error,
  } = useLoader(() => getRemoteStashes(cwd, remote), [cwd, remote, reloadKey]);

  /** Run one action with the list back on screen and a spinner saying what it is doing. */
  const run = async (doing: string, action: () => Promise<OperationResult>) => {
    setScreen({ kind: 'list' });
    setNotice(undefined);
    setBusy(doing);
    try {
      const result = await action();
      setNotice({ text: result.message, tone: result.ok ? 'ok' : 'error' });
    } catch (failed) {
      setNotice({ text: (failed as Error).message, tone: 'error' });
    } finally {
      setBusy(undefined);
      reload();
    }
  };

  const openApply = (stash: RemoteStash) => !busy && setScreen({ kind: 'apply', stash });
  const remove = (stash: RemoteStash) =>
    !busy &&
    prompt.confirm(`Remove ${stash.name} from ${remote} for everyone?`, () =>
      run(`Removing ${stash.name}…`, () => removeRemoteStash(cwd, remote, stash.name)),
    );
  const openSave = () => !busy && setScreen({ kind: 'save' });
  const refresh = () => {
    if (busy) return;
    setNotice(undefined);
    reload();
  };
  const toggleIndex = useCallback(() => setIndex((on) => !on), []);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return exit();
      if (screen.kind !== 'list') return;
      if (key.escape || input === 'q') return exit();
      if (input === 's') return openSave();
      if (input === 'r') return refresh();
      if (input === 'i') return toggleIndex();
      if (input === 'x' && current) return remove(current);
    },
    { isActive: !captured },
  );

  if (screen.kind === 'save') {
    return (
      <StashSaveForm
        cwd={cwd}
        remote={remote}
        onCancel={() => setScreen({ kind: 'list' })}
        onSave={(choice) =>
          void run(`Pushing ${choice.name} to ${remote}…`, () =>
            saveRemoteStash(cwd, remote, choice.name, { force: choice.force, paths: choice.paths }),
          )
        }
      />
    );
  }

  if (screen.kind === 'apply') {
    const { stash } = screen;
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <StashFilesStep
          cwd={cwd}
          stash={stash}
          index={index}
          onToggleIndex={toggleIndex}
          onBack={() => setScreen({ kind: 'list' })}
          onApply={(paths) =>
            void run(`Applying ${stash.name}…`, () =>
              applyRemoteStash(cwd, remote, stash.name, { index, paths }),
            )
          }
        />
      </Box>
    );
  }

  const status = busy ? (
    <Text color={colors.muted} wrap="truncate">
      <SpinnerGlyph /> {busy}
    </Text>
  ) : isLoading ? (
    <Text color={colors.muted} wrap="truncate">
      <SpinnerGlyph /> Reading stashes from {remote}…
    </Text>
  ) : error ? (
    <Text color={colors.error} wrap="truncate">
      {String(error)}
    </Text>
  ) : notice ? (
    <Text color={notice.tone === 'ok' ? colors.ok : colors.error} wrap="truncate">
      {notice.text}
    </Text>
  ) : (
    <Text color={colors.muted} wrap="truncate">
      {stashes.length} stash(es) on {remote} · applying keeps staged changes{' '}
      {index ? 'staged' : 'unstaged'} [i]
    </Text>
  );

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Box flexDirection="column" flexShrink={0}>
        <Toolbar
          actions={[
            { hotkey: 's', label: 'Save new stash', onPress: openSave, tone: 'primary' },
            { hotkey: 'r', label: 'Refresh', onPress: refresh },
            {
              hotkey: 'i',
              label: index ? 'Apply: staged stay staged' : 'Apply: all unstaged',
              onPress: toggleIndex,
            },
            //? Quit is in the hints: a fourth button would stack the bar into a column
          ]}
        />
        {prompt.line ?? status}
      </Box>
      <RemoteStashList
        cwd={cwd}
        remote={remote}
        stashes={stashes}
        isLoading={isLoading}
        isInputActive={!captured && !busy}
        question={prompt.question}
        activateLabel="apply"
        onActivate={openApply}
        onCurrentChange={setCurrent}
        actionsFor={(stash) => [
          { hotkey: 'Enter', label: 'Apply…', onPress: () => openApply(stash), tone: 'primary' },
          { hotkey: 'x', label: 'Remove', onPress: () => remove(stash), tone: 'danger' },
        ]}
        hints={[{ key: 'Esc/q', label: 'quit', onPress: exit }]}
      />
    </Box>
  );
};

/** Open the dashboard until Esc/q. */
const renderInkStashDashboard = async (props: StashDashboardProps) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <StashDashboard {...props} />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
};

export default renderInkStashDashboard;

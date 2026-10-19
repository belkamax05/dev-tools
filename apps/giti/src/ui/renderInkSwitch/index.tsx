import { render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useTerminalSize from '@/dev-tools/ui/hooks/useTerminalSize';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import type { SwitchOptions } from '../../core/branches';
import FlagsPanel, { type FlagOption } from '../dashboard/FlagsPanel';
import SyncBar from '../dashboard/SyncBar';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import type { UndoOffer } from '../dashboard/types';
import useRemoteSync from '../dashboard/useRemoteSync';
import useRepoSnapshot from '../dashboard/useRepoSnapshot';
import useRepoWatch from '../dashboard/useRepoWatch';
import BranchesView from '../dashboard/views/BranchesView';
import { DEFAULT_REFRESH_SECONDS } from '../dashboard/views/SettingsView';

/** `git switch`'s own flags `hop` offers — shown, toggled and explained by the shared `FlagsPanel`. */
const FLAGS: readonly FlagOption[] = [
  {
    flag: '--force',
    label: 'Discard changes',
    about:
      'Switch even when local changes are in the way — they are thrown away (git switch --force).',
  },
  {
    flag: '--detach',
    label: 'Detach',
    about: "Check out the branch's commit on no branch: look around without moving any branch.",
  },
  {
    flag: '--no-track',
    label: 'No tracking',
    about: 'A remote branch, or a new one, becomes a local branch that tracks nothing.',
  },
];

type Section = 'branches' | 'flags';

export interface RenderInkSwitchOptions {
  /** The search to open with — a name that matched no branch outright. */
  initialBranch?: string;
  /** `-c` without a name yet: open on the new-branch prompt. */
  startCreating?: boolean;
  initialFlags: {
    detach: boolean;
    track: boolean;
    noTrack: boolean;
    force: boolean;
  };
  passthroughFlags: string[];
  cwd: string;
}

/**
 * `giti hop`'s screen: the dashboard's own branch picker, full screen, the way `giti save` is
 * the dashboard's staging area — the same list, search, details and actions, the same sync bar
 * above it, and `git switch`'s flags below it in the panel `save` has for its own.
 *
 * Switching to a branch (or making a new one) is the end of it: the screen closes and says where
 * HEAD is now. Anything else the picker does — rename, delete, set upstream, pull — leaves it open.
 */
export const SwitchForm = ({
  cwd,
  initialBranch,
  startCreating = false,
  initialFlags,
  passthroughFlags,
  refreshSeconds = DEFAULT_REFRESH_SECONDS,
  onSwitched,
}: RenderInkSwitchOptions & {
  refreshSeconds?: number;
  onSwitched: (message: string) => void;
}) => {
  const { exit } = useApp();
  const colors = useColors();
  //? No `AppShell` here to size the frame, so the form claims the terminal itself, as `save` does
  const { rows } = useTerminalSize();
  const height = Math.max(1, rows - useTuiTheme().sizes.app.heldBackRows);
  const [section, setSection] = useState<Section>('branches');
  const [flags, setFlags] = useState(
    () =>
      new Set([
        ...(initialFlags.force ? ['--force'] : []),
        ...(initialFlags.detach ? ['--detach'] : []),
        ...(initialFlags.noTrack ? ['--no-track'] : []),
      ]),
  );
  const [notice, setNotice] = useState('');
  const [captured, setCaptured] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [undo, setUndo] = useState<UndoOffer>();

  const { snapshot, refresh, isLoading } = useRepoSnapshot(cwd);
  const root = snapshot?.isRepo ? snapshot.root : undefined;
  const reload = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refresh();
  }, [refresh]);
  //? Kept current as the dashboard is: a branch made or pushed elsewhere shows up in the open list
  useRepoWatch(root, reload);
  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const id = setInterval(reload, refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds, reload]);
  //? The dashboard's quiet fetch on open, so the remote branches listed are the remote's now
  const sync = useRemoteSync(root, { notify: (text) => setNotice(text), reload });

  const runUndo = () => {
    if (!undo) return;
    const offer = undo;
    setUndo(undefined);
    void offer.run().then((result) => {
      setNotice(result.message);
      reload();
    });
  };

  const toggle = (flag: string) =>
    setFlags((previous) => {
      const next = new Set(previous);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });
  const switchOptions: SwitchOptions = {
    force: flags.has('--force'),
    detach: flags.has('--detach'),
    noTrack: flags.has('--no-track'),
    passthrough: passthroughFlags,
  };

  useInput((input, key) => {
    if (captured) return;
    //? The picker owns Esc while the branches have the keys: it clears a search first
    if (key.escape && section === 'flags') return exit();
    if (input === 'q' && !key.ctrl && !key.meta) return exit();
    if (key.tab) return setSection((was) => (was === 'branches' ? 'flags' : 'branches'));
    if (key.return && section === 'flags') return setSection('branches');
    //? The picker's delete says ^Z brings a branch back — the dashboard's footer Undo, here a key
    if (key.ctrl && input === 'z') return runUndo();
    //? The sync bar's keys; `p` is the picker's own, the same pull
    if (!key.ctrl && !key.meta && root) {
      if (input === 'f') return sync.fetch();
      if (input === 'P') return sync.push();
      if (input === 'p' && section === 'flags') return sync.pull();
    }
  });

  const flagSummary = [...flags, ...passthroughFlags].join(' ');
  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Box flexDirection="column" flexShrink={0}>
        <Toolbar
          actions={[
            {
              hotkey: 'Tab',
              label: `Focus: ${section}`,
              onPress: () => setSection((was) => (was === 'branches' ? 'flags' : 'branches')),
            },
            { hotkey: 'Esc/q', label: 'Cancel', onPress: exit },
            ...(undo ? [{ hotkey: '^Z', label: `Undo: ${undo.label}`, onPress: runUndo }] : []),
          ]}
        />
        {snapshot?.isRepo && <SyncBar snapshot={snapshot} sync={sync} />}
        <Text color={colors.accent} wrap="truncate">
          {`Enter → switch to the selected branch${flagSummary ? ` (${flagSummary})` : ''}`}
        </Text>
      </Box>
      {root ? (
        <BranchesView
          root={root}
          refreshKey={refreshKey}
          reload={reload}
          notify={(text) => setNotice(text)}
          onCaptureInput={setCaptured}
          handoff={() => {}}
          offerUndo={setUndo}
          reservedChrome={[]}
          sync={sync}
          onClose={exit}
          initialQuery={initialBranch}
          switchOptions={switchOptions}
          onSwitched={(message) => {
            onSwitched(message);
            exit();
          }}
          startCreating={startCreating}
          isInputActive={section === 'branches'}
        />
      ) : (
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color={isLoading ? colors.muted : colors.error}>
            {isLoading ? 'Reading the repository…' : 'Not a git repository.'}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" flexShrink={0}>
        <FlagsPanel
          options={FLAGS}
          on={flags}
          onToggle={toggle}
          focused={section === 'flags' && !captured}
          onFocus={() => setSection('flags')}
          enterLabel="go back to the branches"
        />
        {/* Messages only — the keys are on the picker's hint row and in the panel's title already;
            the line stays, so a message never shifts the panels above it */}
        <Text color={colors.muted} wrap="truncate">
          {notice || ' '}
        </Text>
      </Box>
    </Box>
  );
};

const renderInkSwitch = async (options: RenderInkSwitchOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE, refreshSeconds: DEFAULT_REFRESH_SECONDS },
  }).load();
  let switched: string | undefined;
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <SwitchForm
        {...options}
        refreshSeconds={config.refreshSeconds}
        onSwitched={(message) => {
          switched = message;
        }}
      />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
  //? Said once the terminal is back, where it stays: the screen itself is gone by then
  if (switched) console.log(`✅ ${switched}`);
};

export default renderInkSwitch;

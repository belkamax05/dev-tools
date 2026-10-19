import { basename } from 'node:path';
import { type DOMElement, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import AppShell from '@/dev-tools/ui/components/AppShell';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useStatus from '@/dev-tools/ui/hooks/useStatus';
import Box from '@/dev-tools/ui/components/Box';
import type { ClearResult, ClearTarget } from '@/dev-tools/ui/components/ClearDataDialog';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';
import type PickerItem from '@/dev-tools/types/PickerItem';

import {
  abortOperation,
  continueOperation,
  getOperation,
  type OperationState,
  skipOperation,
} from '../../../core/operation';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../theme';
import type { GitViewProps, Tone, UndoOffer } from '../types';
import useRepoSnapshot from '../useRepoSnapshot';
import SpinnerGlyph from '../SpinnerGlyph';
import useRemoteSync from '../useRemoteSync';
import useRepoWatch from '../useRepoWatch';
import BranchesView from '../views/BranchesView';
import CommandsView from '../views/CommandsView';
import LogView from '../views/LogView';
import OverviewView from '../views/OverviewView';
import RemotesView from '../views/RemotesView';
import SettingsView, { DEFAULT_REFRESH_SECONDS } from '../views/SettingsView';
import StashView from '../views/StashView';

export type TabId = 'overview' | 'settings';
type OverviewPanel = 'branches' | 'log' | 'stash' | 'remotes';

/**
 * The tab strip.
 *
 * Every icon is an emoji whose base codepoint is East Asian Width *Wide*, and
 * none carries a U+FE0F variation selector — see `TabDefinition` for why that is
 * a requirement rather than a preference. Ink measures the row with
 * `string-width` and the terminal decides for itself how many cells each glyph
 * eats; where the two disagree, every border after the glyph lands a column off.
 */
export const TABS: readonly TabDefinition<TabId>[] = [
  //? Overview is also where Status used to be: see OverviewView for why the two were merged.
  { id: 'overview', icon: '📊', label: '📊 Overview' },
  { id: 'settings', icon: '🔧', label: '🔧 Settings' },
];

export interface AppProps {
  settingsFiles?: { path: string; label: string; detail: string }[];
  /** Directory the user ran `giti` from — the repository everything is read out of. */
  cwd: string;
  /** The command tree, for the command palette. */
  commands: PickerItem[];
  /**
   * Hand a picked command back to the CLI and close the dashboard — the
   * picker feeds the CLI's one dispatch path, and the frame is gone before
   * the command's own output starts.
   */
  onRunCommand: (command: string) => void;
  /** Lend the terminal to an editor or a program, and come back. */
  onHandoff: (intent: Handoff) => void;
  /** What the last handoff did, shown on reopening. */
  notice?: string;
  initialTab?: TabId;
  onTabChange?: (tab: TabId) => void;
  initialPaletteId?: string;
  onThemeChange?: (id: string) => void;
  /** Seconds between background re-reads of the repository; 0 is off. */
  initialRefreshSeconds?: number;
  onRefreshChange?: (seconds: number) => void;
  /** Whether Overview opens with its details expanded (`+`) — remembered between runs. */
  initialDetails?: boolean;
  onDetailsChange?: (details: boolean) => void;
  /** The files Settings' Clear dialog offers; left out, Settings has no Clear row. */
  clearTargets?: ClearTarget[];
  /** The Clear dialog ran: report it once the terminal is back. */
  onCleared?: (results: ClearResult[]) => void;
}

/** The strip across the top while a rebase, merge, cherry-pick or revert waits on you. */
const OperationBanner = ({
  op,
  conflicts,
  onContinue,
  onAbort,
  onSkip,
}: {
  op: OperationState;
  conflicts: number;
  onContinue: () => void;
  onAbort: () => void;
  onSkip: () => void;
}) => {
  const colors = useColors();
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={colors.warn} bold>
        {`${op.kind[0]?.toUpperCase()}${op.kind.slice(1)} in progress`}
        {conflicts
          ? ` · ${conflicts} conflicted — resolve them on Overview`
          : ' · ready to continue'}
        {'  '}
      </Text>
      <ActionButton hotkey="^N" label="Continue" color={colors.accent} onPress={onContinue} />
      {op.canSkip && <ActionButton hotkey="^K" label="Skip" onPress={onSkip} />}
      <ActionButton hotkey="^X" label="Abort" color={colors.error} onPress={onAbort} />
    </Box>
  );
};

/**
 * The way to every giti command, on every tab right above its panel — drawn like the views'
 * own "press / to search" line, and clickable as well as `:`. The footer button stays too.
 */
const CommandsLine = ({ open, onPress }: { open: boolean; onPress: () => void }) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onPress });
  return (
    <Box ref={ref} flexShrink={0}>
      <Text color={isHovered ? colors.highlight : colors.muted}>
        {open ? '— press : or Esc to close the commands' : '— press : for every giti command'}
      </Text>
    </Box>
  );
};

/**
 * giti's dashboard: where you work on a repository, not just look at it.
 *
 * Every tab acts — fetch, pull, push, stage and commit on Overview, switch and
 * branch on Branches, remotes on Remotes — by keyboard or mouse alike: every row, button
 * and hint is clickable and every one has its key. The repository is watched,
 * so nothing is ever stale; a rebase or merge in progress gets a banner with
 * its next steps; a discard or drop can be undone straight after (Ctrl+Z). The
 * command menu that used to be a tab is a palette (`:` or Ctrl+P).
 */
export const App = ({
  settingsFiles,
  cwd,
  commands,
  onRunCommand,
  onHandoff,
  notice,
  initialTab = 'overview',
  onTabChange,
  initialPaletteId = GITI_DEFAULT_PALETTE,
  onThemeChange,
  initialRefreshSeconds = DEFAULT_REFRESH_SECONDS,
  onRefreshChange,
  initialDetails = false,
  onDetailsChange,
  clearTargets,
  onCleared,
}: AppProps) => {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [paletteId, setPaletteId] = useState<string>(initialPaletteId);
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overviewPanel, setOverviewPanel] = useState<OverviewPanel>();
  const { status, setStatus } = useStatus(notice);
  const [undo, setUndo] = useState<UndoOffer | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const [switched, setSwitched] = useState<{ text: string; id: number }>();
  const [details, setDetails] = useState(initialDetails);
  const [refreshSeconds, setRefreshSeconds] = useState(initialRefreshSeconds);

  const { snapshot, error, refresh } = useRepoSnapshot(cwd);
  const root = snapshot?.isRepo ? snapshot.root : undefined;

  const reload = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refresh();
  }, [refresh]);
  useRepoWatch(root, reload);

  //? The watcher catches almost everything as it happens; this is the net under it, so a change
  //? it missed is on screen within `refreshSeconds` rather than whenever something else reloads.
  useEffect(() => {
    if (!root || refreshSeconds <= 0) return;
    const id = setInterval(reload, refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [root, refreshSeconds, reload]);

  const { data: op } = useLoader(
    () => (root ? getOperation(root) : Promise.resolve(undefined)),
    [root, refreshKey],
  );
  const conflicts =
    snapshot?.isRepo && op
      ? [...snapshot.staged, ...snapshot.modified].filter((f) =>
          /U|AA|DD/.test(`${f.index}${f.work}`),
        ).length
      : 0;

  //? An action offers its undo and then reports what it did, in that order —
  //? so the first report after an offer belongs to it and keeps it; any report
  //? after that is about something else, and the offer lapses
  const offeredJustNow = useRef(false);
  const notify = useCallback((text: string, tone: Tone = 'info') => {
    setStatus({ text, tone });
    if (offeredJustNow.current) offeredJustNow.current = false;
    else setUndo(undefined);
  }, []);
  const offerUndo = useCallback((offer: UndoOffer) => {
    offeredJustNow.current = true;
    setUndo(offer);
  }, []);

  //? Fetches once on open, in the background, so ↑/↓ describe the remote as it is now rather
  //? than as of whenever someone last fetched by hand.
  const sync = useRemoteSync(root, {
    notify,
    reload,
    remote: snapshot?.isRepo ? snapshot.remote || 'origin' : 'origin',
  });

  const toggleDetails = () => {
    const next = !details;
    setDetails(next);
    onDetailsChange?.(next);
  };

  const runUndo = async () => {
    if (!undo) return;
    const offer = undo;
    setUndo(undefined);
    const result = await offer.run();
    setStatus({ text: result.message, tone: result.ok ? 'ok' : 'error' });
    reload();
  };

  const opAction = async (action: typeof continueOperation) => {
    if (!root || !op) return;
    const result = await action(root, op);
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const changeTab = (tab: TabId) => {
    setActiveTab(tab);
    setPaletteOpen(false);
    setOverviewPanel(undefined);
    onTabChange?.(tab);
  };

  const changeTheme = (id: string) => {
    if (id === paletteId) return;
    setPaletteId(id);
    onThemeChange?.(id);
  };
  const changeRefresh = (seconds: number) => {
    if (seconds === refreshSeconds) return;
    setRefreshSeconds(seconds);
    onRefreshChange?.(seconds);
  };

  const handoff = useCallback(
    (intent: Handoff) => {
      onHandoff(intent);
      exit();
    },
    [onHandoff, exit],
  );

  const runCommand = useCallback(
    (command: string) => {
      onRunCommand(command);
      //? Unmount before the command runs: the dashboard owns the alternate
      //? screen, and a command writing into it would have its output wiped
      exit();
    },
    [onRunCommand, exit],
  );

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'z') return void runUndo();
      if (key.ctrl && input === 'p') return setPaletteOpen((open) => !open);
      if (op && key.ctrl && input === 'n') return void opAction(continueOperation);
      if (op && key.ctrl && input === 'x') return void opAction(abortOperation);
      if (op && key.ctrl && input === 'k') return void opAction(skipOperation);
      if (paletteOpen && key.escape) return setPaletteOpen(false);
      if (key.escape && overviewPanel && overviewPanel !== 'branches')
        return setOverviewPanel(undefined);
      if (input === 'r' && overviewPanel !== 'branches') reload();
    },
    { isActive: !isInputCaptured },
  );

  const footerActions: FooterAction[] = [
    ...(overviewPanel
      ? [
          {
            id: 'close-panel',
            label: 'Back',
            hotkey: 'Esc',
            onPress: () => setOverviewPanel(undefined),
            tooltip: 'Close this view and return to Overview',
          },
        ]
      : []),
    ...(undo
      ? [
          {
            id: 'undo',
            label: 'Undo',
            hotkey: '^Z',
            onPress: () => void runUndo(),
            tooltip: `Undo: ${undo.label}`,
          },
        ]
      : []),
    {
      id: 'palette',
      label: 'Commands',
      hotkey: ':',
      isOn: paletteOpen,
      onPress: () => setPaletteOpen((open) => !open),
      tooltip: 'Every giti command, searchable — Esc closes',
    },
  ];

  const repoName = snapshot?.root ? basename(snapshot.root) : basename(cwd);
  const detail =
    snapshot === undefined
      ? 'reading…'
      : snapshot.isRepo
        ? `${snapshot.detached ? `detached @ ${snapshot.headShort}` : snapshot.branch} · ${snapshot.headShort}${
            snapshot.ahead || snapshot.behind ? ` · ↑${snapshot.ahead} ↓${snapshot.behind}` : ''
          }`
        : 'not a git repository';

  const shownStatus = undo
    ? { text: `${undo.label} — ^Z undoes it`, tone: 'warn' as const }
    : status;
  const note = error ? <Text>{error}</Text> : snapshot?.root;

  const reservedChrome = op ? ['operationBanner'] : [];
  const viewProps: GitViewProps | undefined = root
    ? {
        root,
        refreshKey,
        reload,
        notify,
        onCaptureInput: setIsInputCaptured,
        handoff,
        offerUndo,
        reservedChrome,
      }
    : undefined;

  return (
    <AppShell
      title={`giti — ${repoName}`}
      detail={detail}
      status={shownStatus}
      note={note}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={changeTab}
      theme={gitiTheme}
      palette={paletteId}
      onPaletteChange={changeTheme}
      isInputCaptured={isInputCaptured || paletteOpen || Boolean(overviewPanel)}
      footerHints="[:] commands"
      footerActions={footerActions}
      underTabs={
        <CommandsLine open={paletteOpen} onPress={() => setPaletteOpen((open) => !open)} />
      }
    >
      {op && (
        <OperationBanner
          op={op}
          conflicts={conflicts}
          onContinue={() => void opAction(continueOperation)}
          onAbort={() => void opAction(abortOperation)}
          onSkip={() => void opAction(skipOperation)}
        />
      )}
      {paletteOpen ? (
        <CommandsView items={commands} onRun={runCommand} onCaptureInput={setIsInputCaptured} />
      ) : activeTab === 'settings' ? (
        //? Before the repository checks: settings mean the same outside a repository
        <SettingsView
          files={settingsFiles}
          onEditFile={(path) => {
            onHandoff({ type: 'edit', path });
            exit();
          }}
          refreshSeconds={refreshSeconds}
          onRefreshChange={changeRefresh}
          clearTargets={clearTargets}
          onCaptureInput={setIsInputCaptured}
          onCleared={
            onCleared &&
            ((results) => {
              onCleared(results);
              //? Quit rather than carry on: the next tab switch or setting would write the
              //? files straight back from what is still in memory
              exit();
            })
          }
        />
      ) : snapshot === undefined ? (
        <Box paddingX={1}>
          <Text>
            <SpinnerGlyph />
            Reading repository…
          </Text>
        </Box>
      ) : !snapshot.isRepo || !viewProps ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>Not a git repository — [:] still opens the command palette.</Text>
          <Text>{cwd}</Text>
        </Box>
      ) : (
        <>
          {overviewPanel === 'branches' ? (
            <BranchesView
              {...viewProps}
              sync={sync}
              onClose={() => setOverviewPanel(undefined)}
              //? Switching is what the picker was opened for: once it went through, back to the
              //? Overview of the branch now checked out — as `giti hop` closes on it
              onSwitched={(message) => {
                //? Said under the branch name on Overview, as a moment's flash — not the status line
                setSwitched((was) => ({ text: message, id: (was?.id ?? 0) + 1 }));
                setOverviewPanel(undefined);
                reload();
              }}
            />
          ) : overviewPanel === 'log' ? (
            <LogView {...viewProps} />
          ) : overviewPanel === 'stash' ? (
            <StashView {...viewProps} />
          ) : overviewPanel === 'remotes' ? (
            <RemotesView {...viewProps} sync={sync} snapshot={snapshot} onRunCommand={runCommand} />
          ) : activeTab === 'overview' ? (
            <OverviewView
              {...viewProps}
              snapshot={snapshot}
              sync={sync}
              details={details}
              onToggleDetails={toggleDetails}
              isInputCaptured={isInputCaptured || paletteOpen}
              onPickBranch={() => setOverviewPanel('branches')}
              onOpenLog={() => setOverviewPanel('log')}
              onOpenStash={() => setOverviewPanel('stash')}
              onOpenRemotes={() => setOverviewPanel('remotes')}
              switched={switched}
            />
          ) : null}
        </>
      )}
    </AppShell>
  );
};

export default App;

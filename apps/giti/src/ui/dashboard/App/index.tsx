import { basename } from 'node:path';
import { Text, useApp, useInput } from 'ink';
import { useCallback, useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import AppShell from '@/dev-tools/ui/components/AppShell';
import Box from '@/dev-tools/ui/components/Box';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { nextThemeId } from '@/dev-tools/ui/theme';
import type { Handoff } from '@/dev-tools/ui/app/runTuiSession';
import type PickerItem from '@/dev-tools/types/PickerItem';

import {
  abortOperation,
  continueOperation,
  getOperation,
  type OperationState,
  skipOperation,
} from '../../../core/operation';
import gitiTheme from '../theme';
import type { GitViewProps, Tone, UndoOffer } from '../types';
import useRepoSnapshot from '../useRepoSnapshot';
import useRepoWatch from '../useRepoWatch';
import BranchesView from '../views/BranchesView';
import CommandsView from '../views/CommandsView';
import LogView from '../views/LogView';
import OverviewView from '../views/OverviewView';
import RemotesView from '../views/RemotesView';
import StashView from '../views/StashView';
import StatusView from '../views/StatusView';
import VendoredView from '../views/VendoredView';

export type TabId = 'overview' | 'status' | 'log' | 'branches' | 'stash' | 'remotes' | 'vendored';

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
  { id: 'overview', icon: '📊', label: '📊 Overview' },
  { id: 'status', icon: '📝', label: '📝 Status' },
  { id: 'log', icon: '🕒', label: '🕒 Log' },
  { id: 'branches', icon: '🌿', label: '🌿 Branches' },
  { id: 'stash', icon: '📥', label: '📥 Stash' },
  { id: 'remotes', icon: '📡', label: '📡 Remotes' },
  { id: 'vendored', icon: '📦', label: '📦 Vendored' },
];

export interface AppProps {
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
}

const StatusNote = ({ text, tone }: { text: string; tone: Tone }) => {
  const colors = useColors();
  const color =
    tone === 'ok'
      ? colors.ok
      : tone === 'warn'
        ? colors.warn
        : tone === 'error'
          ? colors.error
          : colors.muted;
  return (
    <Text color={color} wrap="truncate">
      {text}
    </Text>
  );
};

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
        {conflicts ? ` · ${conflicts} conflicted — resolve them on Status` : ' · ready to continue'}
        {'  '}
      </Text>
      <ActionButton hotkey="^N" label="Continue" color={colors.accent} onPress={onContinue} />
      {op.canSkip && <ActionButton hotkey="^K" label="Skip" onPress={onSkip} />}
      <ActionButton hotkey="^X" label="Abort" color={colors.error} onPress={onAbort} />
    </Box>
  );
};

/**
 * giti's dashboard: where you work on a repository, not just look at it.
 *
 * Every tab acts — stage and commit on Status, switch and branch on Branches,
 * fetch and push on Remotes — by keyboard or mouse alike: every row, button
 * and hint is clickable and every one has its key. The repository is watched,
 * so nothing is ever stale; a rebase or merge in progress gets a banner with
 * its next steps; a discard or drop can be undone straight after (Ctrl+Z). The
 * command menu that used to be a tab is a palette (`:` or Ctrl+P).
 */
export const App = ({
  cwd,
  commands,
  onRunCommand,
  onHandoff,
  notice,
  initialTab = 'overview',
  onTabChange,
  initialPaletteId = 'classic',
  onThemeChange,
}: AppProps) => {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [paletteId, setPaletteId] = useState<string>(initialPaletteId);
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [footerHint, setFooterHint] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: Tone } | undefined>(
    notice ? { text: notice, tone: 'info' } : undefined,
  );
  const [undo, setUndo] = useState<UndoOffer | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const { snapshot, error, refresh } = useRepoSnapshot(cwd);
  const root = snapshot?.isRepo ? snapshot.root : undefined;

  const reload = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refresh();
  }, [refresh]);
  useRepoWatch(root, reload);

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

  const notify = useCallback((text: string, tone: Tone = 'info') => {
    setStatus({ text, tone });
    setUndo(undefined);
  }, []);
  const offerUndo = useCallback((offer: UndoOffer) => setUndo(offer), []);

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
    onTabChange?.(tab);
  };

  const cycleTheme = () => {
    const nextId = nextThemeId(paletteId, 1, gitiTheme.palettes);
    setPaletteId(nextId);
    if (nextId !== paletteId) onThemeChange?.(nextId);
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
      if (input === ':') return setPaletteOpen(true);
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r') reload();
      else if (input === 't' || input === 'T') cycleTheme();
    },
    { isActive: !isInputCaptured },
  );

  const footerActions: FooterAction[] = [
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
    {
      id: 'theme',
      label: 'Theme',
      hotkey: 't',
      onPress: cycleTheme,
      tooltip: 'Step to the next colour theme',
    },
    { id: 'quit', label: 'Quit', hotkey: 'q', onPress: exit, tooltip: 'Close the dashboard' },
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

  const note = undo ? (
    <StatusNote text={`${undo.label} — ^Z undoes it`} tone="warn" />
  ) : status ? (
    <StatusNote text={status.text} tone={status.tone} />
  ) : error ? (
    <Text>{error}</Text>
  ) : (
    snapshot?.root
  );

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

  const hints =
    footerHint ?? `[1-${TABS.length}] / Tab switch tab · [:] commands · [t] theme · [q] quit`;

  return (
    <AppShell
      title={`giti — ${repoName}`}
      detail={detail}
      note={note}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={changeTab}
      theme={gitiTheme}
      palette={paletteId}
      isInputCaptured={isInputCaptured || paletteOpen}
      footerHints={hints}
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
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
      ) : snapshot === undefined ? (
        <Box paddingX={1}>
          <Text>Reading repository…</Text>
        </Box>
      ) : !snapshot.isRepo || !viewProps ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>Not a git repository — [:] still opens the command palette.</Text>
          <Text>{cwd}</Text>
        </Box>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewView snapshot={snapshot} />}
          {activeTab === 'status' && <StatusView {...viewProps} />}
          {activeTab === 'log' && <LogView {...viewProps} />}
          {activeTab === 'branches' && <BranchesView {...viewProps} />}
          {activeTab === 'stash' && <StashView {...viewProps} />}
          {activeTab === 'remotes' && <RemotesView {...viewProps} />}
          {activeTab === 'vendored' && (
            <VendoredView snapshot={snapshot} onRunCommand={runCommand} />
          )}
        </>
      )}
    </AppShell>
  );
};

export default App;

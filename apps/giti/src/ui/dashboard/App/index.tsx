import { Text, useApp, useInput } from 'ink';
import { basename } from 'node:path';
import { useCallback, useState } from 'react';

import AppShell from '@/dev-tools/ui/components/AppShell';
import Box from '@/dev-tools/ui/components/Box';
import type { FooterAction } from '@/dev-tools/ui/components/Footer';
import type { TabDefinition } from '@/dev-tools/ui/components/TabStrip';
import { nextThemeId } from '@/dev-tools/ui/theme';
import type PickerItem from '@/dev-tools/types/PickerItem';

import gitiTheme from '../theme';
import useRepoSnapshot from '../useRepoSnapshot';
import BranchesView from '../views/BranchesView';
import CommandsView from '../views/CommandsView';
import LogView from '../views/LogView';
import OverviewView from '../views/OverviewView';
import RemotesView from '../views/RemotesView';
import StatusView from '../views/StatusView';
import VendoredView from '../views/VendoredView';

export type TabId =
  | 'overview'
  | 'status'
  | 'log'
  | 'branches'
  | 'remotes'
  | 'vendored'
  | 'commands';

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
  { id: 'remotes', icon: '📡', label: '📡 Remotes' },
  { id: 'vendored', icon: '📦', label: '📦 Vendored' },
  { id: 'commands', icon: '📚', label: '📚 Commands' },
];

export interface AppProps {
  /** Directory the user ran `giti` from — the repository everything is read out of. */
  cwd: string;
  /** The command tree, for the Commands tab. */
  commands: PickerItem[];
  /**
   * Hand a picked command back to the CLI and close the dashboard.
   *
   * Resolving rather than dispatching in here is what keeps the picker feeding
   * the CLI's one dispatch path: the name goes back the way it came, and the
   * frame is gone before the command's own output starts.
   */
  onRunCommand: (command: string) => void;
  /**
   * The palette id to start with.
   */
  initialPaletteId?: string;
  /**
   * Callback when the theme changes.
   */
  onThemeChange?: (id: string) => void;
}

/** How long ago a snapshot was taken, in the words a footer has room for. */
const describeAge = (takenAt: number): string => {
  const seconds = Math.round((Date.now() - takenAt) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
};

/**
 * giti's dashboard: the repository across seven tabs, driven by mouse or keyboard.
 *
 * The shell — header, tabs, footer, the too-small screen, the resize readout —
 * is `dev-tools`'s `AppShell`, so what lives here is only what is specific
 * to git: which tabs there are, the one snapshot they all read from, and the
 * actions in the footer.
 */
export const App = ({ cwd, commands, onRunCommand, initialPaletteId = 'classic', onThemeChange }: AppProps) => {
  const { exit } = useApp();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [paletteId, setPaletteId] = useState<string>(initialPaletteId);
  const [isInputCaptured, setIsInputCaptured] = useState(false);
  const [footerHint, setFooterHint] = useState<string | null>(null);

  const { snapshot, isLoading, error, refresh } = useRepoSnapshot(cwd);

  const cycleTheme = useCallback(() => {
    const nextId = nextThemeId(paletteId, 1, gitiTheme.palettes);
    setPaletteId(nextId);
    if (nextId !== paletteId) {
      onThemeChange?.(nextId);
    }
  }, [paletteId, onThemeChange]);

  const runCommand = useCallback(
    (command: string) => {
      onRunCommand(command);
      //? Unmount before the command runs: the dashboard owns the alternate
      //? screen, and a command writing into it would have its output wiped the
      //? moment the screen is handed back.
      exit();
    },
    [onRunCommand, exit],
  );

  useInput(
    (input) => {
      if (input === 'q' || input === 'Q') exit();
      else if (input === 'r' || input === 'R') refresh();
      else if (input === 't' || input === 'T') cycleTheme();
    },
    { isActive: !isInputCaptured },
  );

  const footerActions: FooterAction[] = [
    {
      id: 'refresh',
      label: 'Refresh',
      hotkey: 'r',
      disabled: isLoading,
      onPress: refresh,
      tooltip: 'Re-read the repository — nothing is fetched, so this never touches the network',
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

  //? Three states, not two. Before the first read lands there is nothing to
  //? report, and saying "not a git repository" while still finding out is a
  //? header that contradicts itself a moment later.
  const detail =
    snapshot === undefined
      ? 'reading…'
      : snapshot.isRepo
        ? `${snapshot.detached ? `detached @ ${snapshot.headShort}` : snapshot.branch} · ${snapshot.headShort}`
        : 'not a git repository';

  const note = isLoading ? (
    <Text>reading repository…</Text>
  ) : error ? (
    <Text>{error}</Text>
  ) : snapshot ? (
    `${snapshot.root} · read ${describeAge(snapshot.takenAt)}`
  ) : undefined;

  const hints =
    footerHint ?? `[1-${TABS.length}] / Tab switch tab · [r] refresh · [t] theme · [q] quit`;

  return (
    <AppShell
      title={`giti — ${repoName}`}
      detail={detail}
      note={note}
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      theme={gitiTheme}
      palette={paletteId}
      isInputCaptured={isInputCaptured}
      footerHints={hints}
      footerActions={footerActions}
      onHoverFooterAction={(action) => setFooterHint(action?.tooltip ?? null)}
    >
      {/* The Commands tab works without a repository; everything else is a
          reading of one, so it says so rather than drawing seven empty panes. */}
      {snapshot === undefined ? (
        <Box paddingX={1}>
          <Text>Reading repository…</Text>
        </Box>
      ) : !snapshot.isRepo && activeTab !== 'commands' ? (
        <Box flexDirection="column" paddingX={1}>
          <Text>Not a git repository.</Text>
          <Text>{cwd}</Text>
        </Box>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewView snapshot={snapshot} />}
          {activeTab === 'status' && <StatusView snapshot={snapshot} />}
          {activeTab === 'log' && <LogView snapshot={snapshot} />}
          {activeTab === 'branches' && <BranchesView snapshot={snapshot} />}
          {activeTab === 'remotes' && <RemotesView snapshot={snapshot} />}
          {activeTab === 'vendored' && <VendoredView snapshot={snapshot} />}
          {activeTab === 'commands' && (
            <CommandsView items={commands} onRun={runCommand} onCaptureInput={setIsInputCaptured} />
          )}
        </>
      )}
    </AppShell>
  );
};

export default App;

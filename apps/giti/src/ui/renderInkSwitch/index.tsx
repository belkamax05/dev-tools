import { TextInput } from '@inkjs/ui';
import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import getBranch from '../../utils/getBranch';
import getBranches from '../../utils/getBranches';
import gitExec from '../../utils/gitExec';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabId = 'local' | 'remote' | 'all';

interface BranchEntry {
  name: string;
  isRemote: boolean;
  //? For remote branches: the remote name (e.g. "origin")
  remote: string;
  //? Short name without remote prefix (e.g. "main" from "origin/main")
  shortName: string;
  //? Whether a local tracking branch already exists
  hasLocal: boolean;
}

interface BranchStats {
  ahead: number;
  behind: number;
  recentCommits: Array<{ hash: string; subject: string; author: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const truncateMsg = (msg: string, max = 56) =>
  msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;

const truncateBranch = (name: string, max = 40) =>
  name.length > max ? `…${name.slice(-(max - 1))}` : name;

const truncateAuthor = (author: string, max = 14) =>
  author.length > max ? `${author.slice(0, max - 1)}…` : author;

//? Build the git switch args based on selected branch and options
const buildSwitchArgs = (
  entry: BranchEntry,
  force: boolean,
  noTrack: boolean,
  detach: boolean,
  passthroughFlags: string[],
): string[] => {
  const args = ['switch'];

  if (detach) {
    args.push('--detach', entry.name);
    return args;
  }

  if (entry.isRemote && !entry.hasLocal) {
    //? Checkout remote branch as a new local tracking branch
    //? `git switch -c <shortName> --track <remote>/<shortName>`
    args.push('-c', entry.shortName, '--track', entry.name);
    if (force) args.push('--force');
  } else {
    //? Local branch or remote that already has a local counterpart
    const target = entry.isRemote ? entry.shortName : entry.name;
    args.push(target);
    if (force) args.push('--force');
    if (noTrack) args.push('--no-track');
  }

  args.push(...passthroughFlags);
  return args;
};

const buildCommandPreview = (
  entry: BranchEntry | null,
  newBranchName: string,
  force: boolean,
  noTrack: boolean,
  detach: boolean,
  passthroughFlags: string[],
): string => {
  if (newBranchName.trim()) {
    const parts = ['git', 'switch', '-c', newBranchName.trim()];
    if (force) parts.push('--force');
    parts.push(...passthroughFlags);
    return parts.join(' ');
  }
  if (!entry) return 'git switch <branch>';
  return ['git', ...buildSwitchArgs(entry, force, noTrack, detach, passthroughFlags)].join(' ');
};

// ─── Branch stats loader ──────────────────────────────────────────────────────

const loadBranchStats = async (cwd: string, branchRef: string): Promise<BranchStats> => {
  const [aheadResult, behindResult, logResult] = await Promise.all([
    //? Commits we have that the target doesn't
    gitExec(['rev-list', '--count', `${branchRef}..HEAD`], cwd),
    //? Commits the target has that we don't
    gitExec(['rev-list', '--count', `HEAD..${branchRef}`], cwd),
    //? Most recent commits on the target branch
    gitExec(['log', branchRef, '-6', '--format=%h|%an|%s'], cwd),
  ]);

  const ahead = aheadResult.exitCode === 0 ? parseInt(aheadResult.stdout.trim(), 10) || 0 : 0;
  const behind = behindResult.exitCode === 0 ? parseInt(behindResult.stdout.trim(), 10) || 0 : 0;
  const recentCommits =
    logResult.exitCode === 0
      ? logResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const parts = line.split('|');
            return { hash: parts[0] ?? '', author: parts[1] ?? '', subject: parts[2] ?? '' };
          })
      : [];

  return { ahead, behind, recentCommits };
};

// ─── Tab bar ─────────────────────────────────────────────────────────────────

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'local', label: 'Local' },
  { id: 'remote', label: 'Remote' },
  { id: 'all', label: 'All' },
];

// ─── App ─────────────────────────────────────────────────────────────────────

interface AppProps {
  currentBranch: string;
  allBranches: BranchEntry[];
  initialBranch?: string;
  initialNewBranchName?: string;
  initialForce: boolean;
  initialNoTrack: boolean;
  initialDetach: boolean;
  passthroughFlags: string[];
  cwd: string;
  onSwitch: (args: string[]) => void;
}

type ActiveSection = 'search' | 'list' | 'new';

const App = ({
  currentBranch,
  allBranches,
  initialBranch,
  initialNewBranchName,
  initialForce,
  initialNoTrack,
  initialDetach,
  passthroughFlags,
  cwd,
  onSwitch,
}: AppProps) => {
  const { exit } = useApp();

  const [tab, setTab] = useState<TabId>('local');
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<ActiveSection>('search');
  const [listIndex, setListIndex] = useState(0);
  const [force, setForce] = useState(initialForce);
  const [noTrack, setNoTrack] = useState(initialNoTrack);
  const [detach, setDetach] = useState(initialDetach);
  const [newBranchName, setNewBranchName] = useState(initialNewBranchName ?? '');
  const [stats, setStats] = useState<BranchStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const statsAbortRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isExited, setIsExited] = useState(false);

  useEffect(() => {
    if (isExited) exit();
  }, [isExited, exit]);

  //? Filter branches by tab and search query
  const filtered = allBranches.filter((b) => {
    const matchesTab = tab === 'all' || (tab === 'local' ? !b.isRemote : b.isRemote);
    const matchesQuery = b.name.toLowerCase().includes(query.toLowerCase());
    return matchesTab && matchesQuery;
  });

  const selectedEntry = filtered[listIndex] ?? null;

  //? When selected branch changes, load its divergence stats (debounced)
  useEffect(() => {
    if (!selectedEntry || section === 'new') {
      setStats(null);
      return;
    }
    setStatsLoading(true);
    if (statsAbortRef.current) clearTimeout(statsAbortRef.current);
    statsAbortRef.current = setTimeout(async () => {
      const result = await loadBranchStats(cwd, selectedEntry.name);
      setStats(result);
      setStatsLoading(false);
    }, 120);
  }, [selectedEntry?.name, section, selectedEntry, cwd]);

  //? Reset list cursor when filter changes
  useEffect(() => {
    setListIndex(0);
  }, []);

  //? Pre-select initial branch if given
  useEffect(() => {
    if (!initialBranch) return;
    const idx = filtered.findIndex(
      (b) => b.name === initialBranch || b.shortName === initialBranch,
    );
    if (idx !== -1) setListIndex(idx);
  }, [initialBranch, filtered.findIndex]);

  const handleSwitch = useCallback(() => {
    if (newBranchName.trim()) {
      const args = ['switch', '-c', newBranchName.trim()];
      if (force) args.push('--force');
      args.push(...passthroughFlags);
      onSwitch(args);
      setIsExited(true);
      return;
    }
    if (!selectedEntry) return;
    onSwitch(buildSwitchArgs(selectedEntry, force, noTrack, detach, passthroughFlags));
    setIsExited(true);
  }, [selectedEntry, newBranchName, force, noTrack, detach, passthroughFlags, onSwitch]);

  const command = buildCommandPreview(
    selectedEntry,
    newBranchName,
    force,
    noTrack,
    detach,
    passthroughFlags,
  );

  //? How many rows to show in branch list
  const LIST_HEIGHT = 8;
  const scrollOffset = Math.max(0, listIndex - LIST_HEIGHT + 1);
  const visibleBranches = filtered.slice(scrollOffset, scrollOffset + LIST_HEIGHT);

  useInput((input, key) => {
    //? Global: Ctrl+C → cancel
    if (key.ctrl && input === 'c') {
      setIsExited(true);
      return;
    }

    //? Tab key → cycle between sections
    if (key.tab) {
      if (section === 'search') setSection('list');
      else if (section === 'list') setSection('new');
      else setSection('search');
      return;
    }

    //? Flag toggles and tab-jump shortcuts — only active in the list section to avoid intercepting text typing
    if (section === 'list') {
      if (input === '1') {
        setTab('local');
        setListIndex(0);
        return;
      }
      if (input === '2') {
        setTab('remote');
        setListIndex(0);
        return;
      }
      if (input === '3') {
        setTab('all');
        setListIndex(0);
        return;
      }
      if (input === 'f') {
        setForce((v) => !v);
        return;
      }
      if (input === 't') {
        setNoTrack((v) => !v);
        return;
      }
      if (input === 'd') {
        setDetach((v) => !v);
        return;
      }
    }

    if (section === 'search') {
      //? Down enters list
      if (key.downArrow) {
        setSection('list');
        return;
      }
      if (key.return) {
        setSection('list');
        return;
      }
      return;
    }

    if (section === 'list') {
      if (key.upArrow) {
        setListIndex((i) => {
          if (i === 0) {
            setSection('search');
            return 0;
          }
          return Math.max(0, i - 1);
        });
        return;
      }
      if (key.downArrow) {
        setListIndex((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      //? Left/right to cycle tabs
      if (key.leftArrow) {
        setTab((t) => {
          const idx = TABS.findIndex((tb) => tb.id === t);
          return TABS[(idx - 1 + TABS.length) % TABS.length]?.id ?? t;
        });
        setListIndex(0);
        return;
      }
      if (key.rightArrow) {
        setTab((t) => {
          const idx = TABS.findIndex((tb) => tb.id === t);
          return TABS[(idx + 1) % TABS.length]?.id ?? t;
        });
        setListIndex(0);
        return;
      }
      if (key.return) {
        handleSwitch();
        return;
      }
      if (key.escape) {
        setSection('search');
        return;
      }
      return;
    }

    if (section === 'new') {
      if (key.escape) {
        setSection('list');
        return;
      }
      if (key.return && newBranchName.trim()) {
        handleSwitch();
        return;
      }
    }
  });

  const isCurrentBranchSelected = selectedEntry && selectedEntry.name === currentBranch;

  if (isExited) return null;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box gap={2}>
        <Text bold color="cyan">
          git switch
        </Text>
        <Text dimColor>on</Text>
        <Text bold color="white">
          {currentBranch}
        </Text>
      </Box>

      {/* Search bar */}
      <Box
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'search' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        <Box gap={1}>
          <Text dimColor>🔍</Text>
          <TextInput
            placeholder="Search branches…"
            defaultValue={query}
            onChange={setQuery}
            isDisabled={section !== 'search'}
          />
        </Box>
      </Box>

      {/* Tab bar */}
      <Box marginTop={1} gap={1}>
        {TABS.map((t) => (
          <Box key={t.id} gap={0}>
            <Text
              bold={tab === t.id}
              color={tab === t.id ? 'cyan' : 'gray'}
              underline={tab === t.id}
            >
              {tab === t.id ? '⬤ ' : '○ '}
            </Text>
            <Text bold={tab === t.id} color={tab === t.id ? 'cyan' : 'gray'}>
              {t.label}
            </Text>
          </Box>
        ))}
        <Text dimColor> ← → cycle • 1/2/3 jump</Text>
      </Box>

      {/* Branch list */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'list' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        {filtered.length === 0 ? (
          <Text dimColor>No branches match "{query}"</Text>
        ) : (
          visibleBranches.map((b, visIdx) => {
            const realIdx = scrollOffset + visIdx;
            const isFocused = section === 'list' && realIdx === listIndex;
            const isCurrent = b.name === currentBranch;
            const isRemote = b.isRemote;
            const needsTracking = isRemote && !b.hasLocal;

            return (
              <Box key={b.name} gap={1}>
                <Text color={isFocused ? 'cyan' : undefined}>{isFocused ? '▶' : ' '}</Text>
                {isCurrent ? (
                  <Text color="green">✱</Text>
                ) : needsTracking ? (
                  <Text color="yellow">⬡</Text>
                ) : isRemote ? (
                  <Text color="blue">⬡</Text>
                ) : (
                  <Text color="gray">○</Text>
                )}
                <Text
                  color={isCurrent ? 'green' : isFocused ? 'white' : 'gray'}
                  bold={isFocused || isCurrent}
                >
                  {truncateBranch(b.name)}
                </Text>
                {isCurrent && <Text dimColor>(current)</Text>}
                {needsTracking && (
                  <Text dimColor color="yellow">
                    → creates local tracking
                  </Text>
                )}
              </Box>
            );
          })
        )}
        {filtered.length > LIST_HEIGHT && (
          <Text dimColor>
            {scrollOffset > 0 ? '  ↑ more above' : ''}
            {scrollOffset + LIST_HEIGHT < filtered.length ? '  ↓ more below' : ''}
            {'  ' + filtered.length + ' total'}
          </Text>
        )}
      </Box>

      {/* Divergence preview for selected branch */}
      {selectedEntry && section !== 'new' && (
        <Box
          flexDirection="column"
          marginTop={1}
          borderStyle="round"
          borderColor="gray"
          paddingLeft={1}
          paddingRight={1}
        >
          {statsLoading || !stats ? (
            <Text dimColor>Loading branch info…</Text>
          ) : (
            <>
              <Box gap={2}>
                <Text dimColor>{truncateBranch(selectedEntry.name)}</Text>
                {stats.behind > 0 && (
                  <Text color="cyan">
                    ↓ {stats.behind} commit{stats.behind !== 1 ? 's' : ''} you'll receive
                  </Text>
                )}
                {stats.ahead > 0 && (
                  <Text color="yellow">
                    ↑ {stats.ahead} commit{stats.ahead !== 1 ? 's' : ''} not on target
                  </Text>
                )}
                {stats.ahead === 0 && stats.behind === 0 && (
                  <Text color="gray">identical to current HEAD</Text>
                )}
                {isCurrentBranchSelected && (
                  <Text color="yellow">⚠ this is your current branch</Text>
                )}
              </Box>
              {stats.recentCommits.slice(0, 4).map((c) => (
                <Box key={c.hash} gap={1}>
                  <Text color="yellow">{c.hash}</Text>
                  <Text dimColor>{truncateAuthor(c.author)}</Text>
                  <Text color="gray">{truncateMsg(c.subject)}</Text>
                </Box>
              ))}
            </>
          )}
        </Box>
      )}

      {/* Create new branch */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'new' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text dimColor={section !== 'new'}>
          New branch <Text dimColor>-c</Text>
        </Text>
        <TextInput
          placeholder="Branch name… (leave empty to skip)"
          defaultValue={newBranchName}
          onChange={setNewBranchName}
          isDisabled={section !== 'new'}
        />
      </Box>

      {/* Flags row */}
      <Box marginTop={1} gap={2}>
        <Text dimColor>Flags:</Text>
        <Box gap={1}>
          <Text color={force ? 'red' : 'gray'}>{force ? '✓' : '○'}</Text>
          <Text color={force ? 'red' : 'gray'}>--force</Text>
          <Text dimColor>(f)</Text>
        </Box>
        <Box gap={1}>
          <Text color={noTrack ? 'yellow' : 'gray'}>{noTrack ? '✓' : '○'}</Text>
          <Text color={noTrack ? 'yellow' : 'gray'}>--no-track</Text>
          <Text dimColor>(t)</Text>
        </Box>
        <Box gap={1}>
          <Text color={detach ? 'magenta' : 'gray'}>{detach ? '✓' : '○'}</Text>
          <Text color={detach ? 'magenta' : 'gray'}>--detach</Text>
          <Text dimColor>(d)</Text>
        </Box>
      </Box>

      {/* Footer */}
      <Box marginTop={1} flexDirection="column">
        <Text color="magenta">{command}</Text>
        <Text dimColor>
          Tab cycle sections • ↑↓ navigate •{' '}
          {section === 'list'
            ? '←→ cycle tabs • 1/2/3 jump • f/t/d flags • Enter switch'
            : section === 'new'
              ? 'Enter create & switch • Esc back'
              : 'Enter / ↓ to list'}{' '}
          • Ctrl+C cancel
        </Text>
      </Box>
    </Box>
  );
};

// ─── Export ───────────────────────────────────────────────────────────────────

export interface RenderInkSwitchOptions {
  initialBranch?: string;
  initialNewBranchName?: string;
  initialFlags: {
    detach: boolean;
    track: boolean;
    noTrack: boolean;
    force: boolean;
  };
  passthroughFlags: string[];
  cwd: string;
}

const renderInkSwitch = async ({
  initialBranch,
  initialNewBranchName,
  initialFlags,
  passthroughFlags,
  cwd,
}: RenderInkSwitchOptions) => {
  //? Load branch data before rendering
  const [currentBranch, { local, remote }] = await Promise.all([
    getBranch(cwd).catch(() => 'HEAD'),
    getBranches(cwd),
  ]);

  const localSet = new Set(local);

  //? Build unified branch list with metadata
  const localEntries: BranchEntry[] = local.map((name) => ({
    name,
    isRemote: false,
    remote: '',
    shortName: name,
    hasLocal: true,
  }));

  const remoteEntries: BranchEntry[] = remote
    //? Filter out HEAD pointers (origin/HEAD -> origin/main)
    .filter((name) => !name.endsWith('/HEAD'))
    .map((name) => {
      const slashIdx = name.indexOf('/');
      const remoteName = name.slice(0, slashIdx);
      const shortName = name.slice(slashIdx + 1);
      return {
        name,
        isRemote: true,
        remote: remoteName,
        shortName,
        hasLocal: localSet.has(shortName),
      };
    });

  //? Sort: current branch first, then alphabetical within group
  const sortBranches = (entries: BranchEntry[]) =>
    [...entries].sort((a, b) => {
      if (a.name === currentBranch) return -1;
      if (b.name === currentBranch) return 1;
      return a.name.localeCompare(b.name);
    });

  const allBranches = [...sortBranches(localEntries), ...sortBranches(remoteEntries)];

  let switchArgs: string[] | null = null;

  const { waitUntilExit, unmount, clear } = render(
    <App
      currentBranch={currentBranch}
      allBranches={allBranches}
      initialBranch={initialBranch}
      initialNewBranchName={initialNewBranchName}
      initialForce={initialFlags.force}
      initialNoTrack={initialFlags.noTrack}
      initialDetach={initialFlags.detach}
      passthroughFlags={passthroughFlags}
      cwd={cwd}
      onSwitch={(args) => (switchArgs = args)}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  clear();
  unmount();

  if (switchArgs) {
    const result = await gitExec(switchArgs, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  }
};

export default renderInkSwitch;

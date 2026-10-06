import { Spinner } from '@inkjs/ui';
import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import getBranch from '../../utils/getBranch';
import getRemotes from '../../utils/getRemotes';
import getStatus from '../../utils/getStatus';
import getUpstreamStats from '../../utils/getUpstreamStats';
import gitExec from '../../utils/gitExec';

// ─── Types ──────────────────────────────────────────────────────────────────

interface IncomingCommit {
  hash: string;
  subject: string;
  author: string;
}

//? Mutually exclusive strategies for handling upstream divergence
type MergeStrategy = 'merge' | 'rebase' | 'rebase-merges' | 'ff-only' | 'squash';

interface PullFlag {
  flag: string;
  description: string;
  isUiOnly?: boolean;
}

const EXTRA_FLAGS: PullFlag[] = [
  { flag: '--autostash', description: 'Stash local changes before pull, restore after' },
  { flag: '--no-commit', description: 'Merge but do not auto-commit the result' },
  { flag: '--no-verify', description: 'Skip pre-merge and commit-msg hooks' },
  {
    flag: '--yes',
    description: 'Bypass this TUI next run (shu flag, not passed to git)',
    isUiOnly: true,
  },
];

interface Strategy {
  id: MergeStrategy;
  label: string;
  description: string;
  gitFlag: string | null;
  //? Warn when local commits exist (rebase rewrites history)
  warnsOnLocalCommits?: boolean;
}

const STRATEGIES: Strategy[] = [
  {
    id: 'merge',
    label: 'Merge',
    description: 'Create a merge commit (default git pull)',
    gitFlag: null,
  },
  {
    id: 'rebase',
    label: 'Rebase',
    description: 'Replay local commits on top of upstream',
    gitFlag: '--rebase',
    warnsOnLocalCommits: true,
  },
  {
    id: 'rebase-merges',
    label: 'Rebase (preserve merges)',
    description: 'Rebase and keep merge topology',
    gitFlag: '--rebase=merges',
    warnsOnLocalCommits: true,
  },
  {
    id: 'ff-only',
    label: 'Fast-forward only',
    description: 'Abort if a merge commit would be needed',
    gitFlag: '--ff-only',
  },
  {
    id: 'squash',
    label: 'Squash',
    description: 'Squash upstream commits into one staged change',
    gitFlag: '--squash',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const truncateMsg = (msg: string, max = 58) =>
  msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;

const truncateAuthor = (author: string, max = 16) =>
  author.length > max ? `${author.slice(0, max - 1)}…` : author;

const buildGitArgs = (
  remote: string,
  branch: string,
  strategy: MergeStrategy,
  enabledFlags: Set<string>,
  passthroughFlags: string[],
) => {
  const args = ['pull'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);

  const strat = STRATEGIES.find((s) => s.id === strategy);
  if (strat?.gitFlag) args.push(strat.gitFlag);

  for (const f of EXTRA_FLAGS.filter((f) => !f.isUiOnly)) {
    if (enabledFlags.has(f.flag)) args.push(f.flag);
  }
  args.push(...passthroughFlags);
  return args;
};

const buildCommandPreview = (
  remote: string,
  branch: string,
  strategy: MergeStrategy,
  enabledFlags: Set<string>,
  passthroughFlags: string[],
) => {
  const parts = ['git', 'pull'];
  if (remote) parts.push(remote);
  if (branch) parts.push(branch);

  const strat = STRATEGIES.find((s) => s.id === strategy);
  if (strat?.gitFlag) parts.push(strat.gitFlag);

  for (const f of EXTRA_FLAGS.filter((f) => !f.isUiOnly)) {
    if (enabledFlags.has(f.flag)) parts.push(f.flag);
  }
  parts.push(...passthroughFlags);
  return parts.join(' ');
};

//? Parse porcelain status to detect local uncommitted or staged changes
const hasDirtyWorkingTree = (porcelain: string) =>
  porcelain.split('\n').some((l) => l.trim().length > 0);

// ─── App ────────────────────────────────────────────────────────────────────

interface BranchInfo {
  branch: string;
  remote: string;
  upstreamBranch: string;
  behind: number;
  ahead: number;
  incomingCommits: IncomingCommit[];
  isDirty: boolean;
  localCommitCount: number;
}

type ActiveSection = 'strategy' | 'flags';

interface AppProps {
  branchInfo: BranchInfo;
  initialStrategy: MergeStrategy;
  initialFlags: string[];
  passthroughFlags: string[];
  onPull: (args: string[]) => void;
}

const App = ({ branchInfo, initialStrategy, initialFlags, passthroughFlags, onPull }: AppProps) => {
  const { exit } = useApp();
  const [strategy, setStrategy] = useState<MergeStrategy>(initialStrategy);
  const [stratIndex, setStratIndex] = useState(() =>
    STRATEGIES.findIndex((s) => s.id === initialStrategy),
  );
  const [enabledFlags, setEnabledFlags] = useState<Set<string>>(new Set(initialFlags));
  const [flagIndex, setFlagIndex] = useState(0);
  const [section, setSection] = useState<ActiveSection>('strategy');
  const [expandedCommits, setExpandedCommits] = useState(false);
  const [isExited, setIsExited] = useState(false);

  useEffect(() => {
    if (isExited) exit();
  }, [isExited, exit]);

  const {
    branch,
    remote,
    upstreamBranch,
    behind,
    ahead,
    incomingCommits,
    isDirty,
    localCommitCount,
  } = branchInfo;

  const PREVIEW_COUNT = 5;
  const visibleCommits = expandedCommits
    ? incomingCommits
    : incomingCommits.slice(0, PREVIEW_COUNT);
  const hiddenCount = incomingCommits.length - PREVIEW_COUNT;

  const upstreamLabel = upstreamBranch ? `${remote}/${upstreamBranch}` : `${remote} (no upstream)`;
  const behindColor = behind > 0 ? 'cyan' : 'gray';

  const currentStrategy = STRATEGIES[stratIndex];
  const warnRebase = currentStrategy?.warnsOnLocalCommits && localCommitCount > 0;
  const hasYes = enabledFlags.has('--yes');
  const command = buildCommandPreview(remote, branch, strategy, enabledFlags, passthroughFlags);

  const handlePull = useCallback(() => {
    onPull(buildGitArgs(remote, branch, strategy, enabledFlags, passthroughFlags));
    setIsExited(true);
  }, [remote, branch, strategy, enabledFlags, passthroughFlags, onPull]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      setIsExited(true);
      return;
    }
    if (key.tab) {
      setSection((s) => (s === 'strategy' ? 'flags' : 'strategy'));
      return;
    }
    if (key.escape && section === 'flags') {
      setSection('strategy');
      return;
    }

    if (section === 'strategy') {
      if (key.upArrow) {
        setStratIndex((i) => {
          const next = Math.max(0, i - 1);
          const nextStrategy = STRATEGIES[next];
          if (nextStrategy) setStrategy(nextStrategy.id);
          return next;
        });
        return;
      }
      if (key.downArrow) {
        setStratIndex((i) => {
          const next = Math.min(STRATEGIES.length - 1, i + 1);
          const nextStrategy = STRATEGIES[next];
          if (nextStrategy) setStrategy(nextStrategy.id);
          return next;
        });
        return;
      }
      if (input === 'e') {
        if (incomingCommits.length > PREVIEW_COUNT) setExpandedCommits((v) => !v);
        return;
      }
      if (key.return) {
        setSection('flags');
        return;
      }
    }

    if (section === 'flags') {
      if (key.upArrow) {
        setFlagIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setFlagIndex((i) => Math.min(EXTRA_FLAGS.length - 1, i + 1));
        return;
      }
      if (input === ' ') {
        const f = EXTRA_FLAGS[flagIndex];
        if (f) {
          setEnabledFlags((prev) => {
            const next = new Set(prev);
            if (next.has(f.flag)) next.delete(f.flag);
            else next.add(f.flag);
            return next;
          });
        }
        return;
      }
      if (key.return) {
        handlePull();
        return;
      }
    }
  });

  if (isExited) return null;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box gap={1}>
        <Text bold color="cyan">
          git pull
        </Text>
        <Text bold color="white">
          {branch}
        </Text>
        <Text dimColor>←</Text>
        <Text color="blue">{upstreamLabel}</Text>
        <Text color={behindColor}>
          {behind > 0
            ? `${behind} incoming`
            : ahead > 0
              ? `${ahead} ahead, nothing to pull`
              : 'up to date'}
        </Text>
      </Box>

      {/* Dirty working tree warning */}
      {isDirty && (
        <Box marginTop={1} gap={1}>
          <Text color="yellow">⚠</Text>
          <Text color="yellow">You have uncommitted changes.</Text>
          <Text dimColor>Enable --autostash below to stash them automatically.</Text>
        </Box>
      )}

      {/* Incoming commits panel */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor="gray"
        paddingLeft={1}
        paddingRight={1}
      >
        <Box gap={1}>
          <Text color={behind === 0 ? 'gray' : 'cyan'} bold>
            {behind} {behind === 1 ? 'commit' : 'commits'} to pull
          </Text>
          {incomingCommits.length > PREVIEW_COUNT && (
            <Text dimColor>{'(e to ' + (expandedCommits ? 'collapse' : 'expand all') + ')'}</Text>
          )}
        </Box>
        {behind === 0 && <Text dimColor>Nothing to pull — branch is up to date</Text>}
        {visibleCommits.map((c) => (
          <Box key={c.hash} gap={1}>
            <Text color="yellow">{c.hash}</Text>
            <Text dimColor>{truncateAuthor(c.author)}</Text>
            <Text>{truncateMsg(c.subject)}</Text>
          </Box>
        ))}
        {!expandedCommits && hiddenCount > 0 && (
          <Text dimColor> …and {hiddenCount} more (press e to expand)</Text>
        )}
      </Box>

      {/* Strategy selection */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'strategy' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text dimColor={section !== 'strategy'}>
          Strategy <Text dimColor>↑↓ select</Text>
        </Text>
        {STRATEGIES.map((s, i) => {
          const isSelected = strategy === s.id;
          const isFocused = section === 'strategy' && i === stratIndex;
          return (
            <Box key={s.id} gap={1}>
              <Text color={isFocused ? 'cyan' : undefined}>{isFocused ? '▶' : ' '}</Text>
              <Text color={isSelected ? 'green' : 'gray'}>{isSelected ? '◉' : '○'}</Text>
              <Text color={isSelected ? 'white' : 'gray'} bold={isSelected}>
                {s.label}
              </Text>
              <Text dimColor>{s.description}</Text>
            </Box>
          );
        })}
        {warnRebase && (
          <Box marginTop={1} gap={1}>
            <Text color="yellow">⚠</Text>
            <Text color="yellow">
              You have {localCommitCount} local {localCommitCount === 1 ? 'commit' : 'commits'} —
              rebase will rewrite their history
            </Text>
          </Box>
        )}
      </Box>

      {/* Extra flags */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'flags' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text dimColor={section !== 'flags'}>
          Flags <Text dimColor>Space to toggle</Text>
        </Text>
        {EXTRA_FLAGS.map((f, i) => {
          const isEnabled = enabledFlags.has(f.flag);
          const isFocused = section === 'flags' && i === flagIndex;
          //? Highlight --autostash in yellow when working tree is dirty and it's not yet enabled
          const suggestAutostash = f.flag === '--autostash' && isDirty && !isEnabled;
          return (
            <Box key={f.flag} gap={1}>
              <Text color={isFocused ? 'cyan' : undefined}>{isFocused ? '▶' : ' '}</Text>
              <Text
                color={
                  isEnabled
                    ? f.isUiOnly
                      ? 'yellow'
                      : 'green'
                    : suggestAutostash
                      ? 'yellow'
                      : 'gray'
                }
              >
                {isEnabled ? '✓' : suggestAutostash ? '!' : '○'}
              </Text>
              <Text
                color={
                  f.isUiOnly
                    ? isEnabled
                      ? 'yellow'
                      : 'gray'
                    : isEnabled
                      ? 'white'
                      : suggestAutostash
                        ? 'yellow'
                        : 'gray'
                }
              >
                {f.flag}
              </Text>
              <Text dimColor>{f.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Footer */}
      <Box marginTop={1} flexDirection="column">
        <Box gap={1}>
          <Text color="magenta">{command}</Text>
          {hasYes && <Text color="yellow">--yes</Text>}
        </Box>
        {hasYes && <Text dimColor>--yes is a shu flag and will not be passed to git</Text>}
        <Text dimColor>
          Tab switch •{' '}
          {section === 'strategy'
            ? 'Enter next • ↑↓ choose strategy'
            : 'Esc/Tab back • Space toggle • Enter pull'}{' '}
          • Ctrl+C cancel
        </Text>
      </Box>
    </Box>
  );
};

// ─── Loading screen ─────────────────────────────────────────────────────────

const LoadingScreen = () => (
  <Box padding={1} gap={1}>
    <Spinner />
    <Text dimColor>Fetching upstream info…</Text>
  </Box>
);

// ─── Root component with async data loading ──────────────────────────────────

interface RootProps {
  initialRemote?: string;
  initialBranch?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
  onPull: (args: string[]) => void;
  onUpToDate: (message: string) => void;
}

const Root = ({
  initialRemote,
  initialBranch,
  initialFlags,
  passthroughFlags,
  cwd,
  onPull,
  onUpToDate,
}: RootProps) => {
  const { exit } = useApp();
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null);

  useEffect(() => {
    const load = async () => {
      const upstreamResult = await gitExec(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
        cwd,
      );
      const hasUpstream = upstreamResult.exitCode === 0 && Boolean(upstreamResult.stdout);
      const slashIdx = upstreamResult.stdout.indexOf('/');
      const upstreamRemote = hasUpstream ? upstreamResult.stdout.slice(0, slashIdx) : '';
      const upstreamBranch = hasUpstream ? upstreamResult.stdout.slice(slashIdx + 1) : '';

      //? Refresh the remote-tracking ref before anything is counted. Every number below comes
      //? from that ref, so on a stale one "0 commits to pull" only means "nothing new as of the
      //? last fetch" — which is not enough to tell the user a pull would do nothing.
      const fetchRemote = initialRemote || upstreamRemote;
      const didFetch =
        Boolean(fetchRemote) && (await gitExec(['fetch', fetchRemote], cwd)).exitCode === 0;

      const [currentBranch, remotes, stats, incomingResult, porcelain, localResult] =
        await Promise.all([
          getBranch(cwd).catch(() => 'HEAD'),
          getRemotes(cwd),
          getUpstreamStats(cwd),
          //? Commits that exist upstream but not locally
          gitExec(['log', 'HEAD..@{u}', '--format=%h|%an|%s'], cwd),
          getStatus(cwd).catch(() => ''),
          //? Local commits not on upstream — used to warn about rebase
          gitExec(['rev-list', '--count', '@{u}..HEAD'], cwd),
        ]);

      const branch = initialBranch || currentBranch;
      const remote = initialRemote || upstreamRemote || remotes[0] || 'origin';

      //? Skip the whole TUI only when the outcome is genuinely known: the ref was just
      //? refreshed, the branch tracks an upstream, and the user did not name a remote/branch of
      //? their own — `git pull other main` has nothing to do with what @{u} was counted against,
      //? so a 0 there says nothing about what that pull would bring in.
      if (didFetch && hasUpstream && !initialRemote && !initialBranch && stats.behind === 0) {
        const aheadNote =
          stats.ahead > 0
            ? ` (${stats.ahead} local ${stats.ahead === 1 ? 'commit' : 'commits'} to push)`
            : '';
        const upstream = `${remote}/${upstreamBranch}`;
        onUpToDate(`ℹ️  Nothing to pull — up to date with ${upstream}${aheadNote}.`);
        exit();
        return;
      }

      const incomingCommits: IncomingCommit[] =
        incomingResult.exitCode === 0
          ? incomingResult.stdout
              .split('\n')
              .filter(Boolean)
              .map((line) => {
                const parts = line.split('|');
                return {
                  hash: parts[0] ?? '',
                  author: parts[1] ?? '',
                  subject: parts[2] ?? '',
                };
              })
          : [];

      const localCommitCount =
        localResult.exitCode === 0 ? parseInt(localResult.stdout.trim(), 10) || 0 : 0;

      setBranchInfo({
        branch,
        remote,
        upstreamBranch,
        behind: stats.behind,
        ahead: stats.ahead,
        incomingCommits,
        isDirty: hasDirtyWorkingTree(porcelain),
        localCommitCount,
      });
    };

    load();
  }, [initialRemote, initialBranch, cwd, exit, onUpToDate]);

  if (!branchInfo) return <LoadingScreen />;

  //? Determine initial strategy from flags
  const initialStrategy: MergeStrategy = initialFlags.includes('--rebase=merges')
    ? 'rebase-merges'
    : initialFlags.includes('--rebase')
      ? 'rebase'
      : initialFlags.includes('--ff-only')
        ? 'ff-only'
        : initialFlags.includes('--squash')
          ? 'squash'
          : 'merge';

  const strippedInitialFlags = initialFlags.filter(
    (f) => !['--rebase', '--rebase=merges', '--ff-only', '--squash'].includes(f),
  );

  return (
    <App
      branchInfo={branchInfo}
      initialStrategy={initialStrategy}
      initialFlags={strippedInitialFlags}
      passthroughFlags={passthroughFlags}
      onPull={onPull}
    />
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export interface RenderInkPullOptions {
  initialRemote?: string;
  initialBranch?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
}

const renderInkPull = async ({
  initialRemote,
  initialBranch,
  initialFlags,
  passthroughFlags,
  cwd,
}: RenderInkPullOptions) => {
  let gitArgs: string[] | null = null;
  let upToDateMessage: string | null = null;

  const { waitUntilExit, unmount, clear } = render(
    <Root
      initialRemote={initialRemote}
      initialBranch={initialBranch}
      initialFlags={initialFlags}
      passthroughFlags={passthroughFlags}
      cwd={cwd}
      onPull={(args) => (gitArgs = args)}
      onUpToDate={(message) => (upToDateMessage = message)}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  clear();
  unmount();

  //? Printed after unmount because `clear()` wipes anything ink rendered.
  if (upToDateMessage) {
    console.log(upToDateMessage);
    return;
  }

  if (gitArgs) {
    const result = await gitExec(gitArgs, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  }
};

export default renderInkPull;

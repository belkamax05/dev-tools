import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import getBranch from '../../utils/getBranch';
import getRemotes from '../../utils/getRemotes';
import getUpstreamStats from '../../utils/getUpstreamStats';
import gitExec from '../../utils/gitExec';

interface PushFlag {
  flag: string;
  description: string;
  isDangerous?: boolean;
  isUiOnly?: boolean;
}

const PUSH_FLAGS: PushFlag[] = [
  { flag: '--no-verify', description: 'Skip pre-push hooks' },
  { flag: '--force-with-lease', description: 'Force push only if no upstream changes' },
  { flag: '--force', description: 'Force push (overwrites upstream)', isDangerous: true },
  { flag: '--set-upstream', description: 'Set upstream tracking branch' },
  { flag: '--tags', description: 'Push all tags' },
  { flag: '--dry-run', description: 'Simulate push without sending data' },
  {
    flag: '--yes',
    description: 'Bypass this TUI next run (shu flag, not passed to git)',
    isUiOnly: true,
  },
];

const GIT_FLAGS = PUSH_FLAGS.filter((f) => !f.isUiOnly);

interface CommitEntry {
  hash: string;
  subject: string;
}

const truncateMsg = (msg: string, max = 60) =>
  msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;

const buildGitArgs = (
  remote: string,
  branch: string,
  enabledFlags: Set<string>,
  passthroughFlags: string[],
) => {
  const args = ['push'];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  for (const { flag } of GIT_FLAGS) {
    if (enabledFlags.has(flag)) args.push(flag);
  }
  args.push(...passthroughFlags);
  return args;
};

const buildCommandPreview = (
  remote: string,
  branch: string,
  enabledFlags: Set<string>,
  passthroughFlags: string[],
) => {
  const parts = ['git', 'push'];
  if (remote) parts.push(remote);
  if (branch) parts.push(branch);
  for (const { flag } of GIT_FLAGS) {
    if (enabledFlags.has(flag)) parts.push(flag);
  }
  parts.push(...passthroughFlags);
  return parts.join(' ');
};

interface BranchInfo {
  branch: string;
  remote: string;
  upstreamBranch: string;
  ahead: number;
  behind: number;
  pendingCommits: CommitEntry[];
}

interface AppProps {
  branchInfo: BranchInfo;
  initialFlags: string[];
  passthroughFlags: string[];
  onPush: (args: string[]) => void;
}

const App = ({ branchInfo, initialFlags, passthroughFlags, onPush }: AppProps) => {
  const { exit } = useApp();
  const [enabledFlags, setEnabledFlags] = useState<Set<string>>(new Set(initialFlags));
  const [flagIndex, setFlagIndex] = useState(0);
  //? Toggle showing all pending commits vs just first few
  const [expandedCommits, setExpandedCommits] = useState(false);
  const [isExited, setIsExited] = useState(false);

  useEffect(() => {
    if (isExited) exit();
  }, [isExited, exit]);

  const { branch, remote, upstreamBranch, ahead, behind, pendingCommits } = branchInfo;
  const hasForce = enabledFlags.has('--force');
  const hasForceWithLease = enabledFlags.has('--force-with-lease');
  const hasYes = enabledFlags.has('--yes');

  const command = buildCommandPreview(remote, branch, enabledFlags, passthroughFlags);

  //? Show first 5 commits collapsed, all when expanded
  const PREVIEW_COUNT = 5;
  const visibleCommits = expandedCommits ? pendingCommits : pendingCommits.slice(0, PREVIEW_COUNT);
  const hiddenCount = pendingCommits.length - PREVIEW_COUNT;

  const handlePush = useCallback(() => {
    onPush(buildGitArgs(remote, branch, enabledFlags, passthroughFlags));
    setIsExited(true);
  }, [remote, branch, enabledFlags, passthroughFlags, onPush]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      setIsExited(true);
      return;
    }
    if (key.upArrow) {
      setFlagIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setFlagIndex((i) => Math.min(PUSH_FLAGS.length - 1, i + 1));
      return;
    }
    if (input === ' ') {
      const f = PUSH_FLAGS[flagIndex];
      if (f) {
        setEnabledFlags((prev) => {
          const next = new Set(prev);
          if (next.has(f.flag)) {
            next.delete(f.flag);
          } else {
            //? --force and --force-with-lease are mutually exclusive
            if (f.flag === '--force') next.delete('--force-with-lease');
            if (f.flag === '--force-with-lease') next.delete('--force');
            next.add(f.flag);
          }
          return next;
        });
      }
      return;
    }
    if (input === 'e') {
      if (pendingCommits.length > PREVIEW_COUNT) setExpandedCommits((v) => !v);
      return;
    }
    if (key.return) {
      handlePush();
      return;
    }
  });

  const upstreamLabel = upstreamBranch ? `${remote}/${upstreamBranch}` : `${remote} (no upstream)`;
  const aheadBehindColor = behind > 0 ? 'red' : ahead > 0 ? 'green' : 'gray';
  const aheadBehindLabel =
    ahead > 0 || behind > 0 ? `${ahead} ahead, ${behind} behind` : 'up to date';

  if (isExited) return null;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box gap={1}>
        <Text bold color="cyan">
          git push
        </Text>
        <Text bold color="white">
          {branch}
        </Text>
        <Text dimColor>→</Text>
        <Text color="blue">{upstreamLabel}</Text>
        <Text color={aheadBehindColor}>{aheadBehindLabel}</Text>
      </Box>

      {/* Pending commits panel */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor="gray"
        paddingLeft={1}
        paddingRight={1}
      >
        <Box gap={1}>
          <Text color={ahead === 0 ? 'gray' : 'green'} bold>
            {ahead} {ahead === 1 ? 'commit' : 'commits'} to push
          </Text>
          {pendingCommits.length > PREVIEW_COUNT && (
            <Text dimColor>{'(e to ' + (expandedCommits ? 'collapse' : 'expand all') + ')'}</Text>
          )}
        </Box>
        {ahead === 0 && <Text dimColor>Nothing to push — branch is up to date</Text>}
        {visibleCommits.map((c) => (
          <Box key={c.hash} gap={1}>
            <Text color="yellow">{c.hash}</Text>
            <Text>{truncateMsg(c.subject)}</Text>
          </Box>
        ))}
        {!expandedCommits && hiddenCount > 0 && (
          <Text dimColor> …and {hiddenCount} more (press e to expand)</Text>
        )}
      </Box>

      {/* Flags section */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor="cyan"
        paddingLeft={1}
        paddingRight={1}
      >
        <Text>
          Flags <Text dimColor>Space to toggle</Text>
        </Text>
        {PUSH_FLAGS.map((f, i) => {
          const isEnabled = enabledFlags.has(f.flag);
          const isFocused = i === flagIndex;
          const labelColor = f.isUiOnly
            ? isEnabled
              ? 'yellow'
              : 'gray'
            : f.isDangerous && isEnabled
              ? 'red'
              : isEnabled
                ? 'white'
                : 'gray';
          return (
            <Box key={f.flag} gap={1}>
              <Text color={isFocused ? 'cyan' : undefined}>{isFocused ? '▶' : ' '}</Text>
              <Text
                color={
                  isEnabled ? (f.isDangerous ? 'red' : f.isUiOnly ? 'yellow' : 'green') : 'gray'
                }
              >
                {isEnabled ? '✓' : '○'}
              </Text>
              <Text color={labelColor}>{f.flag}</Text>
              <Text dimColor>{f.description}</Text>
            </Box>
          );
        })}
      </Box>

      {/* Warning for --force */}
      {hasForce && !hasForceWithLease && (
        <Box marginTop={1}>
          <Text color="red">⚠ --force will overwrite upstream history</Text>
        </Box>
      )}

      {/* Non-fast-forward warning — knowable before the push is attempted */}
      {behind > 0 && !hasForce && !hasForceWithLease && (
        <Box marginTop={1} gap={1}>
          <Text color="yellow">⚠</Text>
          <Text color="yellow">
            {behind} upstream {behind === 1 ? 'commit' : 'commits'} missing locally — this push will
            be rejected as non-fast-forward. Pull first, or enable --force-with-lease.
          </Text>
        </Box>
      )}

      {/* Footer */}
      <Box marginTop={1} flexDirection="column">
        <Box gap={1}>
          <Text color="magenta">{command}</Text>
          {hasYes && <Text color="yellow">--yes</Text>}
        </Box>
        {hasYes && <Text dimColor>--yes is a shu flag and will not be passed to git</Text>}
        <Text dimColor>↑↓ navigate • Space toggle • Enter push • Ctrl+C cancel</Text>
      </Box>
    </Box>
  );
};

export interface RenderInkPushOptions {
  initialRemote?: string;
  initialBranch?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
}

const renderInkPush = async ({
  initialRemote,
  initialBranch,
  initialFlags,
  passthroughFlags,
  cwd,
}: RenderInkPushOptions) => {
  const [currentBranch, remotes, stats, upstreamResult, logResult] = await Promise.all([
    getBranch(cwd).catch(() => 'HEAD'),
    getRemotes(cwd),
    getUpstreamStats(cwd),
    gitExec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd),
    //? Fetch ahead commits: log from upstream to HEAD — gitExec always resolves; check exitCode below
    gitExec(['log', '@{u}..HEAD', '--format=%h|%s'], cwd),
  ]);

  const branch = initialBranch || currentBranch;

  let remote = initialRemote || remotes[0] || 'origin';
  let upstreamBranch = '';
  if (upstreamResult.exitCode === 0 && upstreamResult.stdout) {
    const slashIdx = upstreamResult.stdout.indexOf('/');
    remote = initialRemote || upstreamResult.stdout.slice(0, slashIdx) || remote;
    upstreamBranch = upstreamResult.stdout.slice(slashIdx + 1);
  }

  //? Nothing to push is knowable without fetching first, unlike pull: a stale `@{u}` can only
  //? sit behind the real remote, which over-counts `ahead` — it can never hide a commit that
  //? still needs pushing. So `ahead === 0` means HEAD is already contained upstream.
  //? Skipped when the user named a remote/branch of their own, and when nothing is tracked:
  //? `git push -u origin HEAD` is precisely the case where `@{u}` is missing and there is work.
  const hasUpstream = upstreamResult.exitCode === 0 && Boolean(upstreamResult.stdout);
  if (hasUpstream && !initialRemote && !initialBranch && stats.ahead === 0) {
    const behindNote =
      stats.behind > 0
        ? ` (${stats.behind} incoming ${stats.behind === 1 ? 'commit' : 'commits'} — run giti pull)`
        : '';
    console.log(`ℹ️  Nothing to push — up to date with ${remote}/${upstreamBranch}${behindNote}.`);
    return;
  }

  //? If no upstream is set, log command exits non-zero; treat as empty list
  const pendingCommits: CommitEntry[] =
    logResult.exitCode === 0
      ? logResult.stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const pipeIdx = line.indexOf('|');
            return { hash: line.slice(0, pipeIdx), subject: line.slice(pipeIdx + 1) };
          })
      : [];

  const branchInfo: BranchInfo = {
    branch,
    remote,
    upstreamBranch,
    ahead: stats.ahead,
    behind: stats.behind,
    pendingCommits,
  };

  let gitArgs: string[] | null = null;

  const { waitUntilExit, unmount, clear } = render(
    <App
      branchInfo={branchInfo}
      initialFlags={initialFlags}
      passthroughFlags={passthroughFlags}
      onPush={(args) => (gitArgs = args)}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  clear();
  unmount();

  if (gitArgs) {
    const result = await gitExec(gitArgs, cwd);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.log(result.stderr);
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  }
};

export default renderInkPush;

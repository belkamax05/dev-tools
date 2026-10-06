import { TextInput } from '@inkjs/ui';
import { Box, render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import getStatus from '../../utils/getStatus';
import gitExec from '../../utils/gitExec';

interface CommitFlag {
  flag: string;
  description: string;
  isUiOnly?: boolean;
}

const COMMIT_FLAGS: CommitFlag[] = [
  { flag: '--no-verify', description: 'Skip pre-commit and commit-msg hooks' },
  { flag: '--amend', description: 'Amend the last commit' },
  { flag: '--allow-empty', description: 'Allow recording an empty commit' },
  { flag: '--signoff', description: 'Add Signed-off-by trailer' },
  {
    flag: '--yes',
    description: 'Bypass this TUI next run (shu flag, not passed to git)',
    isUiOnly: true,
  },
];

const GIT_FLAGS = COMMIT_FLAGS.filter((f) => !f.isUiOnly);

//? Porcelain XY status codes that indicate a staged change (index column)
const STATUS_LABELS: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

const STATUS_COLORS: Record<string, string> = {
  A: 'green',
  M: 'yellow',
  D: 'red',
  R: 'cyan',
  C: 'cyan',
  T: 'magenta',
};

interface StagedFile {
  code: string;
  path: string;
}

const parseStagedFiles = (porcelain: string): StagedFile[] =>
  porcelain
    .split('\n')
    .filter(Boolean)
    .filter((line) => line[0] !== ' ' && line[0] !== '?')
    .map((line) => ({
      code: line[0] ?? '?',
      //? For renames git outputs "R old -> new"; take the last part
      path: line.slice(3).split(' -> ').pop() ?? line.slice(3),
    }));

const truncatePath = (path: string, max = 48) =>
  path.length > max ? `…${path.slice(-(max - 1))}` : path;

const truncateMsg = (msg: string, max = 60) =>
  msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;

const buildGitArgs = (message: string, enabledFlags: Set<string>, passthroughFlags: string[]) => {
  const args = ['commit'];
  if (message) args.push('-m', message);
  for (const { flag } of GIT_FLAGS) {
    if (enabledFlags.has(flag)) args.push(flag);
  }
  args.push(...passthroughFlags);
  return args;
};

const buildCommandPreview = (
  message: string,
  enabledFlags: Set<string>,
  passthroughFlags: string[],
) => {
  const parts = ['git', 'commit'];
  if (message) parts.push('-m', `"${message}"`);
  for (const { flag } of GIT_FLAGS) {
    if (enabledFlags.has(flag)) parts.push(flag);
  }
  parts.push(...passthroughFlags);
  return parts.join(' ');
};

interface AppProps {
  initialMessage?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  stagedFiles: StagedFile[];
  onCommit: (args: string[]) => void;
}

const App = ({
  initialMessage,
  initialFlags,
  passthroughFlags,
  stagedFiles,
  onCommit,
}: AppProps) => {
  const { exit } = useApp();
  const [message, setMessage] = useState(initialMessage ?? '');
  const [enabledFlags, setEnabledFlags] = useState<Set<string>>(new Set(initialFlags));
  const [section, setSection] = useState<'message' | 'flags'>(initialMessage ? 'flags' : 'message');
  const [flagIndex, setFlagIndex] = useState(0);
  const [error, setError] = useState('');
  //? Toggle showing all staged files vs just first few
  const [expandedFiles, setExpandedFiles] = useState(false);
  const [isExited, setIsExited] = useState(false);

  useEffect(() => {
    if (isExited) exit();
  }, [isExited, exit]);

  const command = buildCommandPreview(message, enabledFlags, passthroughFlags);
  const hasYes = enabledFlags.has('--yes');

  //? How many to show in collapsed state
  const PREVIEW_COUNT = 5;
  const visibleFiles = expandedFiles ? stagedFiles : stagedFiles.slice(0, PREVIEW_COUNT);
  const hiddenCount = stagedFiles.length - PREVIEW_COUNT;

  const handleCommit = useCallback(() => {
    if (!message.trim() && !enabledFlags.has('--amend')) {
      setError('Message required (or enable --amend)');
      setSection('message');
      return;
    }
    onCommit(buildGitArgs(message.trim(), enabledFlags, passthroughFlags));
    setIsExited(true);
  }, [message, enabledFlags, passthroughFlags, onCommit]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      setIsExited(true);
      return;
    }
    if (key.tab) {
      setSection((s) => (s === 'message' ? 'flags' : 'message'));
      setError('');
      return;
    }

    if (section === 'flags' && key.escape) {
      setSection('message');
      setError('');
      return;
    }

    if (section === 'message' && key.return) {
      setSection('flags');
      setError('');
      return;
    }

    if (section === 'flags') {
      if (key.upArrow) {
        setFlagIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setFlagIndex((i) => Math.min(COMMIT_FLAGS.length - 1, i + 1));
        return;
      }
      if (input === ' ') {
        const flag = COMMIT_FLAGS[flagIndex]?.flag;
        if (flag) {
          setEnabledFlags((prev) => {
            const next = new Set(prev);
            if (next.has(flag)) next.delete(flag);
            else next.add(flag);
            return next;
          });
        }
        return;
      }
      if (input === 'e') {
        if (stagedFiles.length > PREVIEW_COUNT) setExpandedFiles((v) => !v);
        return;
      }
      if (key.return) {
        handleCommit();
        return;
      }
    }
  });

  const stagedColor = stagedFiles.length === 0 ? 'red' : 'green';

  if (isExited) return null;

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        git commit
      </Text>

      {/* Staged files summary */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor="gray"
        paddingLeft={1}
        paddingRight={1}
      >
        <Box gap={1}>
          <Text color={stagedColor} bold>
            {stagedFiles.length} {stagedFiles.length === 1 ? 'file' : 'files'} staged
          </Text>
          {stagedFiles.length > PREVIEW_COUNT && (
            <Text dimColor>{'(e to ' + (expandedFiles ? 'collapse' : 'expand all') + ')'}</Text>
          )}
        </Box>
        {stagedFiles.length === 0 && (
          <Text dimColor>Nothing staged — stage files with git add first</Text>
        )}
        {visibleFiles.map((f) => (
          <Box key={f.path} gap={1}>
            <Text color={STATUS_COLORS[f.code] ?? 'gray'} bold>
              {f.code}
            </Text>
            <Text color={STATUS_COLORS[f.code] ?? 'gray'}>{truncatePath(f.path)}</Text>
            <Text dimColor>{STATUS_LABELS[f.code] ?? ''}</Text>
          </Box>
        ))}
        {!expandedFiles && hiddenCount > 0 && (
          <Text dimColor> …and {hiddenCount} more (press e to expand)</Text>
        )}
      </Box>

      {/* Message section */}
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={section === 'message' ? 'cyan' : 'gray'}
        paddingLeft={1}
        paddingRight={1}
      >
        <Text dimColor={section !== 'message'}>Message</Text>
        <TextInput
          placeholder="Commit message..."
          defaultValue={initialMessage}
          onChange={setMessage}
          isDisabled={section !== 'message'}
        />
        {error ? <Text color="red">{error}</Text> : null}
      </Box>

      {/* Flags section */}
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
        {COMMIT_FLAGS.map((f, i) => {
          const isEnabled = enabledFlags.has(f.flag);
          const isFocused = section === 'flags' && i === flagIndex;
          return (
            <Box key={f.flag} gap={1}>
              <Text color={isFocused ? 'cyan' : undefined}>{isFocused ? '▶' : ' '}</Text>
              <Text color={isEnabled ? 'green' : 'gray'}>{isEnabled ? '✓' : '○'}</Text>
              <Text
                color={f.isUiOnly ? (isEnabled ? 'yellow' : 'gray') : isEnabled ? 'white' : 'gray'}
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
          {section === 'flags' ? 'Esc/Tab back • Space toggle • Enter commit' : 'Enter next'} •
          Ctrl+C cancel
        </Text>
      </Box>
    </Box>
  );
};

export interface RenderInkCommitOptions {
  initialMessage?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
}

const renderInkCommit = async ({
  initialMessage,
  initialFlags,
  passthroughFlags,
  cwd,
}: RenderInkCommitOptions) => {
  const [porcelain] = await Promise.all([getStatus(cwd).catch(() => '')]);
  const stagedFiles = parseStagedFiles(porcelain);

  let gitArgs: string[] | null = null;

  const { waitUntilExit, unmount, clear } = render(
    <App
      initialMessage={initialMessage}
      initialFlags={initialFlags}
      passthroughFlags={passthroughFlags}
      stagedFiles={stagedFiles}
      onCommit={(args) => (gitArgs = args)}
    />,
    { exitOnCtrlC: false },
  );

  await waitUntilExit();
  clear();
  unmount();

  if (gitArgs) {
    const result = await gitExec(gitArgs, cwd, { stream: true });
    if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
  }
};

export default renderInkCommit;
// truncatePath and truncateMsg exported for potential reuse
export { truncateMsg, truncatePath };

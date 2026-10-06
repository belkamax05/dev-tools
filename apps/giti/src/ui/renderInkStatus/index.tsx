import { Box, render, Text } from 'ink';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FileEntry {
  index: string;
  work: string;
  path: string;
  origPath?: string;
}

interface CommitEntry {
  hash: string;
  author: string;
  rel: string;
  subject: string;
}

export interface StatusData {
  branch: string;
  upstream: string;
  remote: string;
  ahead: number;
  behind: number;
  staged: FileEntry[];
  modified: FileEntry[];
  untracked: FileEntry[];
  conflicted: FileEntry[];
  stashCount: number;
  recentCommits: CommitEntry[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-change',
  U: 'unmerged',
};

const STATUS_COLOR: Record<string, string> = {
  A: 'green',
  M: 'yellow',
  D: 'red',
  R: 'cyan',
  C: 'cyan',
  T: 'magenta',
  U: 'red',
};

const truncatePath = (p: string, max = 52) => (p.length > max ? `…${p.slice(-(max - 1))}` : p);

const truncateMsg = (msg: string, max = 56) =>
  msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;

const truncateAuthor = (a: string, max = 14) => (a.length > max ? `${a.slice(0, max - 1)}…` : a);

// ─── Sub-components ───────────────────────────────────────────────────────────

const Divider = ({ label }: { label: string }) => (
  <Box gap={1} marginTop={1}>
    <Text dimColor>{'─'.repeat(3)}</Text>
    <Text bold color="white">
      {label}
    </Text>
  </Box>
);

const FileRow = ({ entry, useIndex = true }: { entry: FileEntry; useIndex?: boolean }) => {
  const code = useIndex ? entry.index : entry.work;
  const color = STATUS_COLOR[code] ?? 'gray';
  const label = STATUS_LABEL[code] ?? '';
  return (
    <Box gap={2} paddingLeft={2}>
      <Text color={color} bold>
        {code}
      </Text>
      <Text color={color}>{truncatePath(entry.path)}</Text>
      {entry.origPath && <Text dimColor>← {truncatePath(entry.origPath, 30)}</Text>}
      <Text dimColor>{label}</Text>
    </Box>
  );
};

const SectionFiles = ({
  files,
  useIndex,
  max = 10,
}: {
  files: FileEntry[];
  useIndex?: boolean;
  max?: number;
}) => {
  const visible = files.slice(0, max);
  const hidden = files.length - max;
  return (
    <>
      {visible.map((f) => (
        <FileRow key={`${f.index}${f.work}${f.path}`} entry={f} useIndex={useIndex} />
      ))}
      {hidden > 0 && (
        <Box paddingLeft={2}>
          <Text dimColor>…and {hidden} more</Text>
        </Box>
      )}
    </>
  );
};

// ─── Main display ─────────────────────────────────────────────────────────────

const StatusDisplay = ({ data }: { data: StatusData }) => {
  const {
    branch,
    upstream,
    remote,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    conflicted,
    stashCount,
    recentCommits,
  } = data;

  const isClean =
    staged.length === 0 &&
    modified.length === 0 &&
    untracked.length === 0 &&
    conflicted.length === 0;

  const upstreamLabel = upstream
    ? `${remote}/${upstream}`
    : `${remote || 'no remote'} (no upstream)`;

  return (
    <Box flexDirection="column" paddingTop={1} paddingBottom={1} paddingLeft={1} paddingRight={1}>
      {/* ── Branch & tracking ── */}
      <Box gap={2} flexWrap="wrap">
        <Box gap={1}>
          <Text dimColor>branch</Text>
          <Text bold color="cyan">
            {branch}
          </Text>
        </Box>
        <Text dimColor>→</Text>
        <Text color="blue">{upstreamLabel}</Text>
        <Text color={ahead > 0 ? 'green' : 'gray'}>↑ {ahead} ahead</Text>
        <Text color={behind > 0 ? 'yellow' : 'gray'}>↓ {behind} behind</Text>
        {isClean && <Text color="green">✓ clean</Text>}
      </Box>

      {/* ── Conflicts ── */}
      {conflicted.length > 0 && (
        <>
          <Divider label={`Conflicts (${conflicted.length})`} />
          <Box paddingLeft={2}>
            <Text color="red">⚠ Merge conflicts — resolve before committing</Text>
          </Box>
          <SectionFiles files={conflicted} useIndex={false} />
        </>
      )}

      {/* ── Staged ── */}
      {staged.length > 0 && (
        <>
          <Divider label={`Staged (${staged.length})`} />
          <SectionFiles files={staged} useIndex />
        </>
      )}

      {/* ── Modified ── */}
      {modified.length > 0 && (
        <>
          <Divider label={`Modified (${modified.length})`} />
          <SectionFiles files={modified} useIndex={false} />
        </>
      )}

      {/* ── Untracked ── */}
      {untracked.length > 0 && (
        <>
          <Divider label={`Untracked (${untracked.length})`} />
          <SectionFiles files={untracked} useIndex={false} max={8} />
        </>
      )}

      {/* ── Stash ── */}
      {stashCount > 0 && (
        <>
          <Divider label={`Stash (${stashCount})`} />
          <Box paddingLeft={2} gap={1}>
            <Text dimColor>
              {stashCount} {stashCount === 1 ? 'entry' : 'entries'} — run
            </Text>
            <Text color="magenta">git stash list</Text>
            <Text dimColor>to see them</Text>
          </Box>
        </>
      )}

      {/* ── Recent commits ── */}
      {recentCommits.length > 0 && (
        <>
          <Divider label="Recent commits" />
          {recentCommits.map((c) => (
            <Box key={c.hash} paddingLeft={2} gap={2}>
              <Text color="yellow">{c.hash}</Text>
              <Text dimColor>{truncateAuthor(c.author)}</Text>
              <Text>{truncateMsg(c.subject)}</Text>
              <Text dimColor>{c.rel}</Text>
            </Box>
          ))}
        </>
      )}

      {/* ── Contextual hints ── */}
      <Box marginTop={1} gap={3} flexWrap="wrap">
        {staged.length > 0 && (
          <Box gap={1}>
            <Text color="magenta">shu git commit</Text>
            <Text dimColor>
              to commit {staged.length} staged {staged.length === 1 ? 'file' : 'files'}
            </Text>
          </Box>
        )}
        {modified.length > 0 && staged.length === 0 && (
          <Box gap={1}>
            <Text color="magenta">git add .</Text>
            <Text dimColor>to stage all changes</Text>
          </Box>
        )}
        {ahead > 0 && (
          <Box gap={1}>
            <Text color="magenta">shu git push</Text>
            <Text dimColor>
              to push {ahead} {ahead === 1 ? 'commit' : 'commits'}
            </Text>
          </Box>
        )}
        {behind > 0 && (
          <Box gap={1}>
            <Text color="magenta">shu git pull</Text>
            <Text dimColor>
              to pull {behind} {behind === 1 ? 'commit' : 'commits'}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ─── Render function (called by command) ─────────────────────────────────────

const renderInkStatus = async (data: StatusData) => {
  const { unmount } = render(<StatusDisplay data={data} />);
  //? One tick is enough for Ink to flush the initial render; then exit cleanly
  unmount();
  process.exit(0);
};

export default renderInkStatus;

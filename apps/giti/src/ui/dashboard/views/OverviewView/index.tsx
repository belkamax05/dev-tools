import { Text } from 'ink';
import { basename } from 'node:path';

import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import type { Stat } from '@/dev-tools/ui/components/StatList';
import StatList from '@/dev-tools/ui/components/StatList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';

/** Below this the cards are stacked one per row rather than set in two columns. */
const TWO_COLUMN_COLUMNS = 96;

export interface OverviewViewProps {
  snapshot: RepoSnapshot;
}

/**
 * Everything worth knowing about the repository at a glance.
 *
 * Cards rather than one long list because the four questions a dashboard answers
 * — where am I, what have I changed, where is that relative to the remote, and
 * who am I doing it as — are independent of each other, and a reader looking for
 * one of them should not have to read the other three on the way past.
 */
export const OverviewView = ({ snapshot }: OverviewViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const twoColumn = viewport.columns >= TWO_COLUMN_COLUMNS;

  const {
    root,
    branch,
    detached,
    headShort,
    headFull,
    headSubject,
    upstream,
    remote,
    originUrl,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    conflicted,
    stashCount,
    user,
    commits,
    localBranches,
    remoteBranches,
    mergedBranches,
    remotes,
    vendored,
  } = snapshot;

  const changeCount = staged.length + modified.length + untracked.length + conflicted.length;
  const isClean = changeCount === 0;

  const repository: Stat[] = [
    { label: 'repo', value: basename(root) || root, emphasis: true, color: colors.accent },
    {
      label: 'branch',
      value: detached ? `${headShort} (detached)` : branch || '—',
      color: detached ? colors.warn : colors.accent,
      emphasis: true,
    },
    { label: 'head', value: headShort || '—', color: colors.heading },
    { label: 'subject', value: headSubject || '—' },
    { label: 'path', value: root || '—', color: colors.muted },
  ];

  const workingTree: Stat[] = isClean
    ? [{ label: 'state', value: 'clean', color: colors.ok, emphasis: true }]
    : [
        {
          label: 'conflicted',
          value: String(conflicted.length),
          color: conflicted.length > 0 ? colors.error : colors.muted,
          emphasis: conflicted.length > 0,
        },
        {
          label: 'staged',
          value: String(staged.length),
          color: staged.length > 0 ? colors.ok : colors.muted,
        },
        {
          label: 'modified',
          value: String(modified.length),
          color: modified.length > 0 ? colors.warn : colors.muted,
        },
        {
          label: 'untracked',
          value: String(untracked.length),
          color: untracked.length > 0 ? colors.muted : colors.muted,
        },
      ];

  const sync: Stat[] = [
    {
      label: 'upstream',
      value: upstream ? `${remote || 'origin'}/${upstream}` : 'not tracking',
      color: upstream ? colors.text : colors.warn,
    },
    {
      label: 'ahead',
      value: String(ahead),
      color: ahead > 0 ? colors.ok : colors.muted,
      hint: ahead > 0 ? 'to push' : undefined,
      emphasis: ahead > 0,
    },
    {
      label: 'behind',
      value: String(behind),
      color: behind > 0 ? colors.warn : colors.muted,
      hint: behind > 0 ? 'to pull' : undefined,
      emphasis: behind > 0,
    },
    {
      label: 'stash',
      value: String(stashCount),
      color: stashCount > 0 ? colors.highlight : colors.muted,
      hint: stashCount > 0 ? (stashCount === 1 ? 'entry' : 'entries') : undefined,
    },
  ];

  const identity: Stat[] = [
    { label: 'name', value: user.name || '—' },
    {
      label: 'email',
      value: user.email || '—',
      color: user.isValid ? colors.text : colors.warn,
    },
    { label: 'origin', value: originUrl || 'no origin remote', color: colors.muted },
  ];

  const inventory: Stat[] = [
    { label: 'local branches', value: String(localBranches.length) },
    { label: 'remote branches', value: String(remoteBranches.length) },
    {
      label: 'merged',
      value: String(Math.max(0, mergedBranches.length - 1)),
      hint: 'safe to delete',
      color: mergedBranches.length > 1 ? colors.highlight : colors.muted,
    },
    { label: 'remotes', value: String(remotes.length) },
    { label: 'vendored', value: String(vendored.length), hint: 'subrepos + subtrees' },
    { label: 'commits read', value: String(commits.length) },
  ];

  //? Both columns get the same label width so the values line up across the
  //? whole dashboard rather than per card — four cards with values at four
  //? different offsets read as four unrelated boxes.
  const labelWidth = 15;

  const cards = [
    { key: 'repository', title: 'Repository', stats: repository },
    {
      key: 'working-tree',
      title: 'Working tree',
      badge: isClean ? 'clean' : `${changeCount} changed`,
      badgeColor: isClean ? colors.ok : colors.warn,
      stats: workingTree,
    },
    {
      key: 'sync',
      title: 'Upstream',
      badge: ahead === 0 && behind === 0 ? 'in sync' : `↑${ahead} ↓${behind}`,
      badgeColor: behind > 0 ? colors.warn : ahead > 0 ? colors.ok : colors.muted,
      stats: sync,
    },
    { key: 'identity', title: 'Identity', stats: identity },
    { key: 'inventory', title: 'Inventory', stats: inventory },
  ];

  const left = twoColumn ? cards.filter((_, index) => index % 2 === 0) : cards;
  const right = twoColumn ? cards.filter((_, index) => index % 2 === 1) : [];

  const renderColumn = (column: typeof cards) =>
    column.map((card) => (
      <Panel key={card.key} title={card.title} badge={card.badge} badgeColor={card.badgeColor}>
        <StatList stats={card.stats} labelWidth={labelWidth} />
      </Panel>
    ));

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexDirection="row" flexGrow={1} overflow="hidden">
        <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          {renderColumn(left)}
        </Box>
        {twoColumn && (
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
            {renderColumn(right)}
          </Box>
        )}
      </Box>

      {/* The full hash, given a row of its own: it is the one value on this
          screen someone is going to want to copy, and truncating it into a card
          would make it the one value they cannot. */}
      <Box marginTop={1} flexShrink={0}>
        <Text color={colors.muted}>HEAD </Text>
        <Text color={colors.heading} wrap="truncate">
          {headFull || '—'}
        </Text>
      </Box>
    </Box>
  );
};

export default OverviewView;

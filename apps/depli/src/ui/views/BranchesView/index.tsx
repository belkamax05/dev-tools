import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import HintBar, { type Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import SpinnerGlyph from '@/dev-tools/ui/components/SpinnerGlyph';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';
import { barInnerWidth } from '@/dev-tools/ui/theme';
import hotkeys from '@/dev-tools/config/hotkeys';

import { fuzzyFilter } from '../../../core/fuzzy';
import type { BranchHead } from '../../../core/plugin';
import type { Session } from '../../types';
import type { DepliData } from '../../useDepli';

export interface BranchesViewProps {
  data: Pick<
    DepliData,
    | 'branch'
    | 'current'
    | 'branches'
    | 'connections'
    | 'allBranches'
    | 'loadBranches'
    | 'selectBranch'
  >;
  watch: string[];
  /** `branches.recent` is set: the list is its pick, not the watch patterns. */
  recent?: { limit?: number };
  /**
   * `branches.custom`: a name typed into the filter that is not listed can be picked as it is —
   * the list is not every branch (a Jenkins choice list).
   */
  custom?: boolean;
  /** Where the list comes from (`branches.provider`) — named in its title. */
  source?: string;
  session: Session;
  onCaptureInput: (captured: boolean) => void;
  /** A branch was picked: show its chain. */
  onPicked: () => void;
  /** Esc with nothing to clear: back to the chain, the branch unchanged. */
  onClose?: () => void;
  /** [B] clicked: back to the checkout's branch — the key itself is handled app-wide. */
  onBackToCheckout?: () => void;
}

/**
 * The provider's branches by newest commit — `branches.recent`'s pick (or the watched ones), or
 * on [a] every branch it has. Read from the provider (GitHub, a Jenkins job), never from the local
 * checkout. With `custom`, a typed name that is not listed can be used as it is. `/`
 * filters fuzzily as you type (`r2616` finds `release-26.16`), over all branches when the
 * listed ones do not have it. Enter makes one the chain's branch; the pick lasts until another.
 */
export const BranchesView = ({
  data,
  watch,
  recent,
  custom = false,
  source = 'the provider',
  session,
  onCaptureInput,
  onPicked,
  onClose,
  onBackToCheckout,
}: BranchesViewProps) => {
  const colors = useColors();
  const theme = useTuiTheme();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [filter, setFilter] = useState(session.branchFilter ?? '');
  const { branches, loadBranches, allBranches } = data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once connections land
  useEffect(() => {
    if (!branches) loadBranches(allBranches);
  }, [data.connections, branches === undefined]);

  const changeFilter = (value: string) => {
    setFilter(value);
    session.branchFilter = value;
    //? Typing a name that is not watched: look through every branch rather than show nothing
    if (value && !allBranches) loadBranches(true);
  };

  const askFilter = () =>
    prompt.ask('Branch (fuzzy):', (value) => changeFilter(value.trim()), {
      initial: filter,
      onChange: changeFilter,
    });

  useInput(
    (input, key) => {
      if (input === hotkeys.search) askFilter();
      else if (input === 'a') loadBranches(!allBranches);
      else if (key.escape && filter) changeFilter('');
      else if (key.escape) onClose?.();
    },
    { isActive: !prompt.isOpen },
  );

  const listed = branches ?? [];
  const row = (head: BranchHead): PickItem<BranchHead> => ({
    id: head.name,
    label: `${head.name === data.branch ? '✓' : ' '} ${head.name}`,
    hint: `${(head.committedAt ?? '').slice(0, 10)}${head.name === data.current ? ' · checked out' : ''}`,
    hintColor: head.name === data.current ? colors.accent : colors.muted,
    value: head,
  });
  //? Filtering ranks across everything; unfiltered, newest commit first
  const matched: PickItem<BranchHead>[] = filter
    ? fuzzyFilter(listed, filter, (head) => head.name).map(row)
    : listed.map(row);
  //? A name nobody listed: offered as typed, last — a trigger then offers to add it where refused
  const typed =
    custom && filter && !listed.some((head) => head.name === filter)
      ? {
          id: `typed:${filter}`,
          label: `+ ${filter}`,
          hint: 'as typed — not listed',
          hintColor: colors.warn,
          value: {
            name: filter,
            sha: '',
            message: `Not one of ${source}'s branches: used exactly as typed. A trigger whose job refuses it offers to add it to that job's list.`,
          },
        }
      : undefined;
  const items = typed ? [...matched, typed] : matched;
  const scope = allBranches
    ? `All branches (${branches?.length ?? '…'})`
    : recent
      ? `Most recent on ${source} (${branches?.length ?? '…'})`
      : `Watched: ${watch.join(' ')}`;

  //? The header's keys are buttons too: a click does exactly what the key does
  const title = 'Pick a branch ';
  const matching = filter ? `matching "${filter}" — ${items.length} · ` : '';
  const headerHints: Hint[] = filter
    ? [{ key: 'Esc', label: 'clear', onPress: () => changeFilter('') }]
    : [
        { key: hotkeys.search, label: 'filter', onPress: askFilter },
        {
          key: 'a',
          label: `all / ${recent ? 'recent' : 'watched'}`,
          onPress: () => loadBranches(!allBranches),
        },
        ...(data.current && data.branch !== data.current
          ? [{ key: 'B', label: `back to ${data.current}`, onPress: onBackToCheckout }]
          : []),
        ...(onClose ? [{ key: 'Esc', label: 'back to the chain', onPress: onClose }] : []),
      ];
  const hintsWidth = Math.max(
    0,
    barInnerWidth(viewport.columns, viewport.shows.barBorders !== false, theme.sizes.app) -
      Bun.stringWidth(title + matching),
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0} flexDirection="row">
        {prompt.line ?? (
          <>
            <Text color={colors.heading} bold>
              {title}
            </Text>
            {matching && <Text color={colors.muted}>{matching}</Text>}
            <HintBar hints={headerHints} width={hintsWidth} isActive={!prompt.isOpen} />
          </>
        )}
      </Box>
      <ListDetail
        key={`branches-${filter}-${allBranches}-${data.branch}-${items.some((item) => item.id === data.branch)}`}
        title={scope}
        items={items}
        emptyText={
          branches ? (
            'No branch matches'
          ) : (
            <>
              <SpinnerGlyph />
              Reading branches…
            </>
          )
        }
        detailTitle="Branch"
        reservedChrome={['viewHeader']}
        activateLabel="use this branch"
        initialSelectedId={filter ? items[0]?.id : (data.branch ?? session.selected.branches)}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: hotkeys.search, label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
          {
            key: 'a',
            label: allBranches ? (recent ? 'recent only' : 'watched only') : 'all branches',
            onPress: () => loadBranches(!allBranches),
          },
        ]}
        onActivate={(item) => {
          if (!item.value) return;
          data.selectBranch(item.value.name);
          onPicked();
        }}
        onSelectionChange={(item) => {
          session.selected.branches = item?.id;
        }}
        renderDetail={(item) => {
          const head = item?.value;
          if (!head) return null;
          return (
            <Box flexDirection="column">
              <Text color={colors.text}>{head.name}</Text>
              {(head.sha || head.committedAt) && (
                <Text color={colors.muted}>
                  {head.sha.slice(0, 12)}
                  {head.sha && head.committedAt ? ' · ' : ''}
                  {head.committedAt ?? ''}
                </Text>
              )}
              {head.message && (
                <Text color={colors.text} wrap="wrap">
                  {head.message}
                </Text>
              )}
              <Text> </Text>
              <Text color={colors.muted} wrap="wrap">
                {head.name === data.branch
                  ? 'The chain is showing this branch.'
                  : 'Enter shows its chain. The checkout is not switched, and switching it does not change the pick.'}
              </Text>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default BranchesView;

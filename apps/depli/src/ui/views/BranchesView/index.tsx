import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

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
  session: Session;
  /** Arrived here with `b` from the chain: open the filter at once. */
  startFiltering: boolean;
  onCaptureInput: (captured: boolean) => void;
  /** A branch was picked: show its chain. */
  onPicked: () => void;
  /** Esc with nothing to clear: back to the chain, the branch unchanged. */
  onClose?: () => void;
}

/**
 * The provider's branches by newest commit — `branches.recent`'s pick (or the watched ones), or
 * on [a] every branch it has. Read from the provider (GitHub), never from the local checkout. `/`
 * filters fuzzily as you type (`r2616` finds `release-26.16`), over all branches when the
 * listed ones do not have it. Enter makes one the chain's branch; the pick lasts until another.
 */
export const BranchesView = ({
  data,
  watch,
  recent,
  session,
  startFiltering,
  onCaptureInput,
  onPicked,
  onClose,
}: BranchesViewProps) => {
  const colors = useColors();
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival
  useEffect(() => {
    if (startFiltering) askFilter();
  }, []);

  useInput(
    (input, key) => {
      if (input === '/') askFilter();
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
  const items: PickItem<BranchHead>[] = filter
    ? fuzzyFilter(listed, filter, (head) => head.name).map(row)
    : listed.map(row);
  const scope = allBranches
    ? `All branches (${branches?.length ?? '…'})`
    : recent
      ? `Most recent on GitHub (${branches?.length ?? '…'})`
      : `Watched: ${watch.join(' ')}`;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            <Text color={colors.heading} bold>
              Pick a branch{' '}
            </Text>
            {filter
              ? `matching "${filter}" — ${items.length} · [Esc] clear`
              : `[/] filter · [a] all / ${recent ? 'recent' : 'watched'} · [B] the checkout's branch${onClose ? ' · [Esc] back to the chain' : ''}`}
          </Text>
        )}
      </Box>
      <ListDetail
        key={`branches-${filter}-${allBranches}-${data.branch}-${items.some((item) => item.id === data.branch)}`}
        title={scope}
        items={items}
        emptyText={branches ? 'No branch matches' : 'Reading branches…'}
        detailTitle="Branch"
        reservedChrome={['viewHeader']}
        activateLabel="use this branch"
        initialSelectedId={filter ? items[0]?.id : (data.branch ?? session.selected.branches)}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
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
              <Text color={colors.muted}>
                {head.sha.slice(0, 12)}
                {head.committedAt ? ` · ${head.committedAt}` : ''}
              </Text>
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

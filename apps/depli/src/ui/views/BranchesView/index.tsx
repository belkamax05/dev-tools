import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { orderBranches } from '../../../core/branch';
import { fuzzyFilter } from '../../../core/fuzzy';
import type { BranchHead } from '../../../core/plugin';
import type { Session } from '../../types';
import type { DepliData } from '../../useDepli';

export interface BranchesViewProps {
  data: DepliData;
  watch: string[];
  session: Session;
  /** Arrived here with `b` from the chain: open the filter at once. */
  startFiltering: boolean;
  onCaptureInput: (captured: boolean) => void;
  /** A branch was picked: show its chain. */
  onPicked: () => void;
}

/**
 * The watched branches (newest push first) — or, on [a], every branch the provider has. `/`
 * filters fuzzily as you type (`r2616` finds `release-26.16`), over all branches when the
 * watched ones do not have it. Enter makes one the chain's branch; the pick lasts until the
 * checkout switches branches.
 */
export const BranchesView = ({
  data,
  watch,
  session,
  startFiltering,
  onCaptureInput,
  onPicked,
}: BranchesViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [filter, setFilter] = useState(session.branchFilter ?? '');
  const { branches, loadBranches, allBranches } = data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once connections land
  useEffect(() => {
    if (!branches || !data.localBranches) loadBranches(allBranches);
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
    },
    { isActive: !prompt.isOpen },
  );

  //? Checked out first, then the other local branches, then the provider's (watched or all)
  const ordered = orderBranches(
    data.current,
    data.localBranches ?? [],
    branches ?? [],
    data.pushedBranches,
  );
  const row = (head: (typeof ordered)[number]): PickItem<BranchHead> => ({
    id: head.name,
    label: `${head.name === data.branch ? '✓' : ' '} ${head.name}`,
    hint:
      head.section === 'current'
        ? head.localOnly
          ? 'checked out · local only'
          : 'checked out'
        : head.localOnly
          ? 'local only'
          : (head.committedAt ?? '').slice(0, 10),
    hintColor: head.localOnly
      ? colors.warn
      : head.section === 'current'
        ? colors.accent
        : colors.muted,
    value: head,
  });
  const sectionTitle = {
    current: 'Checked out',
    local: 'Local branches',
    remote: allBranches ? 'All branches' : 'Watched',
  } as const;
  //? Filtering ranks across everything; unfiltered, the sections keep their headings
  const items: PickItem<BranchHead>[] = filter
    ? fuzzyFilter(ordered, filter, (head) => head.name).map(row)
    : ordered.flatMap((head, index) =>
        index === 0 || ordered[index - 1]?.section !== head.section
          ? [
              { id: `header-${head.section}`, label: sectionTitle[head.section], isHeader: true },
              row(head),
            ]
          : [row(head)],
      );
  const scope = allBranches
    ? `All branches (${branches?.length ?? '…'})`
    : `Watched: ${watch.join(' ')}`;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            {filter
              ? `matching "${filter}" — ${items.length} · [Esc] clear`
              : '[/] filter · [a] all / watched · [B] back to the checkout branch'}
          </Text>
        )}
      </Box>
      <ListDetail
        key={`branches-${filter}-${allBranches}`}
        title={scope}
        items={items}
        emptyText={branches || data.localBranches ? 'No branch matches' : 'Reading branches…'}
        detailTitle="Branch"
        reservedChrome={['viewHeader']}
        activateLabel="use this branch"
        initialSelectedId={filter ? items[0]?.id : (session.selected.branches ?? data.branch)}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
          {
            key: 'a',
            label: allBranches ? 'watched only' : 'all branches',
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
                  : 'Enter shows its chain. The checkout is not switched; switching it there resets the pick.'}
              </Text>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default BranchesView;

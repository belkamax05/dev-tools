import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  type Branch,
  type BranchSort,
  compareWithCurrent,
  createBranch,
  deleteBranch,
  getBranches,
  mergeBranch,
  renameBranch,
  setUpstream,
  sortBranches,
  switchBranch,
} from '../../../../core/branches';
import type { OperationResult } from '../../../../core/status';
import PatchLines from '../../PatchLines';
import SpinnerGlyph from '../../SpinnerGlyph';
import type { GitViewProps } from '../../types';

const trackHint = (branch: Branch) =>
  [
    branch.isCurrent ? 'current' : undefined,
    branch.ahead ? `↑${branch.ahead}` : undefined,
    branch.behind ? `↓${branch.behind}` : undefined,
    branch.gone ? 'upstream gone' : undefined,
    branch.merged ? 'merged' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

//? Same as CommandsView's: control bytes arrive as part of escape sequences
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping controls is the point
const printable = (input: string): string => input.replace(/[\u0000-\u001F\u007F]/g, '');

/**
 * Local and remote branches, and everything you do with one: switch to it,
 * start a new one from it, rename, set what it tracks, see what it has that
 * the current branch does not — and delete it, but only once it is merged.
 */
export const BranchesView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  reservedChrome,
}: GitViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [compare, setCompare] = useState(false);
  const [sort, setSort] = useState<BranchSort>('time');
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const { data: branches = [], isLoading } = useLoader(() => getBranches(root), [root, refreshKey]);
  const checkedOut = branches.find((b) => b.isCurrent);

  //? The search box takes the keyboard, so the app's own keys (digits, q, r)
  //? must stand down while it is open — and get it back on Esc or unmount.
  useEffect(() => {
    onCaptureInput(isSearching);
  }, [isSearching, onCaptureInput]);
  useEffect(() => () => onCaptureInput(false), [onCaptureInput]);
  const current = branches.find((b) => `${b.isRemote ? 'r' : 'l'}:${b.name}` === currentId);
  const { data: diff = '' } = useLoader(
    () =>
      current && compare && !current.isCurrent
        ? compareWithCurrent(root, current.name)
        : Promise.resolve(''),
    [current?.name, compare, refreshKey],
  );

  const run = async (action: () => Promise<OperationResult>) => {
    const result = await action();
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const switchTo = (branch: Branch) => {
    if (branch.isCurrent) return notify(`Already on ${branch.name}`, 'info');
    void run(() => switchBranch(root, branch));
  };
  const create = (branch?: Branch) =>
    prompt.ask(`New branch${branch ? ` from ${branch.name}` : ''}:`, (name) => {
      if (name.trim()) void run(() => createBranch(root, name, branch?.name));
    });
  const rename = (branch: Branch) =>
    prompt.ask(
      `Rename ${branch.name} to:`,
      (name) => {
        if (name.trim()) void run(() => renameBranch(root, branch.name, name));
      },
      { initial: branch.name },
    );
  const remove = (branch: Branch) =>
    prompt.confirm(`Delete ${branch.name}? It is merged, so nothing is lost.`, () =>
      run(() => deleteBranch(root, branch)),
    );
  const merge = (branch: Branch) => {
    if (branch.isCurrent || !checkedOut) return;
    prompt.confirm(`Merge ${branch.name} into ${checkedOut.name}?`, () =>
      run(() => mergeBranch(root, branch)),
    );
  };
  const toggleSort = () => setSort((by) => (by === 'time' ? 'name' : 'time'));
  const track = (branch: Branch) =>
    prompt.ask(
      `${branch.name} tracks:`,
      (upstream) => {
        if (upstream.trim()) void run(() => setUpstream(root, branch.name, upstream.trim()));
      },
      { initial: branch.upstream || `origin/${branch.name}` },
    );

  useInput(
    (input, key) => {
      if (isSearching) {
        if (key.escape) {
          setIsSearching(false);
          setQuery('');
        } else if (key.return) setIsSearching(false);
        else if (key.backspace || key.delete) setQuery((text) => text.slice(0, -1));
        else if (!key.ctrl && !key.meta) {
          const typed = printable(input);
          if (typed) setQuery((text) => text + typed);
        }
        return;
      }
      //? `startsWith`: "/" and the first letters typed can land in one chunk
      if (input.startsWith('/')) {
        setIsSearching(true);
        setQuery(printable(input.slice(1)));
        return;
      }
      if (key.escape && query) return setQuery('');
      if (input === 'n') return create(current);
      if (input === 's') return toggleSort();
      if (!current) return;
      if (key.return) switchTo(current);
      else if (input === 'v') setCompare((on) => !on);
      else if (input === 'M') merge(current);
      else if (current.isRemote) return;
      else if (input === 'r') rename(current);
      else if (input === 'x') remove(current);
      else if (input === 'u') track(current);
    },
    { isActive: !prompt.isOpen },
  );

  const needle = query.toLowerCase();
  const shown = sortBranches(
    branches.filter((b) => b.name.toLowerCase().includes(needle)),
    sort,
  );
  const local = shown.filter((b) => !b.isRemote);
  const remote = shown.filter((b) => b.isRemote);
  const toItem = (branch: Branch): PickItem<Branch> => ({
    id: `${branch.isRemote ? 'r' : 'l'}:${branch.name}`,
    label: branch.name,
    hint: trackHint(branch),
    hintColor: branch.isCurrent ? colors.accent : branch.gone ? colors.warn : undefined,
    value: branch,
    isCurrent: branch.isCurrent,
  });
  const items: PickItem<Branch>[] = [
    ...(local.length
      ? [
          { id: 'header-local', label: `Local (${local.length})`, isHeader: true },
          ...local.map(toItem),
        ]
      : []),
    ...(remote.length
      ? [
          { id: 'header-remote', label: `Remote (${remote.length})`, isHeader: true },
          ...remote.map(toItem),
        ]
      : []),
  ];

  const actionsFor = (branch: Branch): ToolbarAction[] => [
    {
      hotkey: 'Enter',
      label: branch.isCurrent ? 'Checked out' : 'Switch',
      onPress: () => switchTo(branch),
      tone: 'primary',
      disabled: branch.isCurrent,
    },
    { hotkey: 'n', label: 'New from here', onPress: () => create(branch) },
    ...(!branch.isCurrent
      ? [
          { hotkey: 'v', label: 'Compare', onPress: () => setCompare((on) => !on), isOn: compare },
          {
            hotkey: 'Shift+M',
            label: `Merge into ${checkedOut?.name ?? 'HEAD'}`,
            onPress: () => merge(branch),
            disabled: !checkedOut,
          },
        ]
      : []),
    ...(!branch.isRemote
      ? [
          { hotkey: 'r', label: 'Rename', onPress: () => rename(branch) },
          { hotkey: 'u', label: 'Set upstream', onPress: () => track(branch) },
          {
            hotkey: 'x',
            label: 'Delete',
            onPress: () => remove(branch),
            tone: 'danger' as const,
            //? Unmerged work is never deleted from a list — merge it first
            disabled: !branch.merged,
          },
        ]
      : []),
  ];

  const hints: Hint[] = [
    { key: 'n', label: 'new branch', onPress: () => create(current) },
    { key: '/', label: 'search', onPress: () => setIsSearching(true) },
    {
      key: 's',
      label: sort === 'time' ? 'sort: time' : 'sort: name',
      onPress: toggleSort,
    },
    ...(query ? [{ key: 'Esc', label: 'clear', onPress: () => setQuery('') }] : []),
  ];

  const rows = Math.max(
    3,
    viewport.contentRows(
      ['appShell', 'viewHints', 'panelFrame', 'viewHeader', ...reservedChrome],
      3,
    ) - 4,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <>
            <Text wrap="truncate" color={colors.muted}>
              {isLoading && !branches.length && <SpinnerGlyph />}
              {isLoading && !branches.length
                ? 'Reading branches…'
                : `${local.length} local · ${remote.length} remote · by ${sort} `}
            </Text>
            {isSearching || query ? (
              <>
                <Text color={colors.accent}>/{query}</Text>
                {isSearching && <Text color={colors.highlight}>▌</Text>}
              </>
            ) : (
              <Text color={colors.muted}>— press / to search</Text>
            )}
          </>
        )}
      </Box>
      <ListDetail
        title={`Branches (${shown.length})`}
        items={items}
        emptyText={
          query
            ? `No branch matches "${query}".`
            : 'No branches — this repository has no commits yet.'
        }
        detailTitle={current?.name ?? 'Branch'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="switch"
        activateOnClick={false}
        isInputActive={!prompt.isOpen && !isSearching}
        hints={hints}
        onActivate={(item) => item.value && switchTo(item.value)}
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const branch = item?.value;
          if (!branch) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(branch)} />
              {compare && !branch.isCurrent ? (
                <PatchLines text={diff} rows={rows} />
              ) : (
                <Box flexDirection="column">
                  <Text bold color={branch.isCurrent ? colors.accent : colors.text}>
                    {branch.name}
                  </Text>
                  <Text color={colors.muted} wrap="truncate">
                    {branch.subject} · {branch.when}
                  </Text>
                  {!branch.isRemote && (
                    <Text color={branch.upstream ? colors.text : colors.warn} wrap="truncate">
                      tracks {branch.upstream || 'nothing'}
                      {branch.upstream ? ` · ${branch.ahead} ahead, ${branch.behind} behind` : ''}
                    </Text>
                  )}
                  {!branch.isRemote && !branch.isCurrent && (
                    <Text color={branch.merged ? colors.ok : colors.muted}>
                      {branch.merged
                        ? 'merged into HEAD — safe to delete'
                        : 'has commits HEAD does not'}
                    </Text>
                  )}
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default BranchesView;

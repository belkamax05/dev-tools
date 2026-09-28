import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ChipRow from '@/dev-tools/ui/components/ChipRow';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import type { ProcessInfo } from '@/dev-tools/utils/process/listProcesses';

import {
  describeState,
  formatRss,
  getCwd,
  getSnapshot,
  type ProcessRow,
  SCOPE_LABELS,
  SCOPES,
  type Scope,
  SORT_KEYS,
  SORT_LABELS,
  type SortKey,
  stopPids,
} from '../../../core/processes';
import type { Session, Tone } from '../../types';

export interface ProcessesViewProps {
  /** Draw the table as a forest under each process's parent rather than as a flat list. */
  tree: boolean;
  root: string;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  /** Bumped by the app's refresh key. */
  refreshKey: number;
  /** 0 while paused or switched off. */
  refreshSeconds: number;
  onStateChange: () => void;
  onCaptureInput: (captured: boolean) => void;
}

const MY_UID = process.getuid?.();

/**
 * The fixed-width columns every row starts with, and the header drawn over them. One function for
 * both, so the labels cannot drift from the values: the header goes in the list's title, which
 * `PickList` draws from the same cell the rows' two-cell cursor marker starts in — hence the two
 * leading spaces on the header only.
 */
const columns = (pid: string, cpu: string, mem: string, name: string) =>
  `${pid.padStart(7)} ${cpu.padStart(5)} ${mem.padStart(5)}  ${name}`;
const HEADER = `  ${columns('PID', 'CPU%', 'MEM', 'NAME')}`;

const next = <T,>(list: readonly T[], at: T): T => list[(list.indexOf(at) + 1) % list.length] ?? at;

const Detail = ({
  row,
  parent,
  childCount,
}: {
  row: ProcessRow;
  parent?: ProcessInfo;
  childCount: number;
}) => {
  const colors = useColors();
  //? Read per selection rather than for every row: one readlink, only for the process in view
  const { data: cwd } = useLoader(() => row.cwd ?? getCwd(row.pid), [row.pid]);
  return (
    <Box flexDirection="column">
      <Text bold color={colors.heading} wrap="truncate">
        {`${row.name} (${row.pid})`}
      </Text>
      <Text color={colors.muted} wrap="truncate">
        {`user ${row.user} · ${describeState(row.state)}`}
      </Text>
      <Text color={colors.text} wrap="truncate">
        {`cpu ${row.cpu.toFixed(1)}% · mem ${row.mem.toFixed(1)}% (${formatRss(row.rss)}) · up ${row.elapsed}`}
      </Text>
      <Text color={colors.muted} wrap="truncate">
        {`parent ${parent ? `${parent.name} (${parent.pid})` : row.ppid} · ${childCount} child process${childCount === 1 ? '' : 'es'}`}
      </Text>
      {cwd && (
        <Text color={colors.muted} wrap="truncate-start">
          {`in ${cwd}`}
        </Text>
      )}
      <Box marginTop={1}>
        <Text color={colors.text} wrap="wrap">
          {row.command}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * The process table, btop-style: live CPU, sortable, scoped to this user or to the folder
 * processi was started in, filterable, and stoppable.
 *
 * The list is keyed on its row order. A refresh re-sorts it — by CPU, every couple of seconds —
 * and `ListDetail` keeps the cursor on an *index*, so without the remount the cursor would stay
 * put while the processes moved under it and the next `k` would stop whatever slid into place.
 * Remounting restores the cursor by pid instead, so it follows the process it was on.
 */
export const ProcessesView = ({
  tree,
  root,
  session,
  notify,
  refreshKey,
  refreshSeconds,
  onStateChange,
  onCaptureInput,
}: ProcessesViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [scope, setScope] = useState<Scope>(session.scope);
  const [sort, setSort] = useState<SortKey>(session.sort);
  const [filter, setFilter] = useState(session.filter);
  const [busy, setBusy] = useState(false);
  const tab = tree ? 'tree' : 'processes';
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected[tab]);

  const { data, isLoading, reload } = useLoader(
    () => getSnapshot({ scope, sort, query: filter, tree, root }),
    [scope, sort, filter, tree, root, refreshKey],
  );

  useEffect(() => {
    if (refreshSeconds <= 0 || prompt.isOpen || busy) return;
    const id = setInterval(reload, refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds, prompt.isOpen, busy, reload]);

  const rows = data?.rows ?? [];
  const all = data?.all ?? [];
  const current = rows.find((row) => String(row.pid) === currentId);

  const changeScope = (value: Scope) => {
    setScope(value);
    session.scope = value;
    onStateChange();
  };
  const changeSort = (value: SortKey) => {
    setSort(value);
    session.sort = value;
    onStateChange();
  };
  const changeFilter = (value: string) => {
    setFilter(value);
    session.filter = value;
  };

  const items: PickItem<ProcessRow>[] = rows.map((row) => {
    const branch = tree && row.depth > 0 ? `${'  '.repeat(row.depth - 1)}└ ` : '';
    return {
      id: String(row.pid),
      label: columns(
        String(row.pid),
        row.cpu.toFixed(1),
        formatRss(row.rss),
        `${branch}${row.name}`,
      ),
      hint: row.uid !== MY_UID ? row.user : row.pid === process.pid ? 'processi' : undefined,
      hintColor: row.uid !== MY_UID ? colors.muted : colors.accent,
      value: row,
    };
  });

  const stop = (row: ProcessRow | undefined, options: { force?: boolean; tree?: boolean } = {}) => {
    if (!row || busy) return;
    if (row.pid === process.pid) {
      notify('That is processi itself — [q] quits', 'warn');
      return;
    }
    const children = all.filter((proc) => proc.ppid === row.pid).length;
    const whose = row.uid !== MY_UID ? ` — ${row.user}'s, needs sudo` : '';
    const extra = options.tree && children ? ` and its ${children}+ children` : '';
    prompt.confirm(
      `${options.force ? 'Kill' : 'Stop'} ${row.name} (${row.pid})${extra}${whose} (${options.force ? 'SIGKILL now' : 'SIGTERM, SIGKILL after 2s'})?`,
      () => {
        setBusy(true);
        notify(`Stopping ${row.pid}…`);
        void stopPids([row.pid], options)
          .then((results) => {
            const failed = results.filter((result) => !result.ok);
            notify(
              results.length > 1
                ? `${results.length - failed.length} of ${results.length} stopped${failed[0] ? ` · ${failed[0].message}` : ''}`
                : (results[0]?.message ?? 'Nothing to stop'),
              failed.length ? 'error' : 'ok',
            );
          })
          .finally(() => {
            setBusy(false);
            reload();
          });
      },
    );
  };

  const stopParent = (row: ProcessRow | undefined) => {
    const parent = row && all.find((proc) => proc.pid === row.ppid);
    if (!row || !parent || parent.pid <= 1) {
      notify('No parent worth stopping — it was started by init', 'warn');
      return;
    }
    stop({ ...parent, depth: 0 });
  };

  const askFilter = () =>
    prompt.ask('Filter (pid, name, command or user):', (value) => changeFilter(value.trim()), {
      initial: filter,
    });

  useInput(
    (input, key) => {
      if (busy) return;
      if (input === 'k') stop(current);
      else if (input === 'K') stop(current, { force: true });
      else if (input === 'g') stop(current, { tree: true });
      else if (input === 'p') stopParent(current);
      else if (input === 's') changeSort(next(SORT_KEYS, sort));
      else if (input === 'f') changeScope(next(SCOPES, scope));
      else if (input === '/') askFilter();
      else if (key.escape && filter) changeFilter('');
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (row: ProcessRow): ToolbarAction[] =>
    [
      { hotkey: 'k', label: 'Stop', onPress: () => stop(row), tone: 'primary' as const },
      {
        hotkey: 'K',
        label: 'Kill now',
        onPress: () => stop(row, { force: true }),
        tone: 'danger' as const,
      },
      { hotkey: 'g', label: 'Stop + children', onPress: () => stop(row, { tree: true }) },
      ...(row.ppid > 1
        ? [{ hotkey: 'p', label: 'Stop parent', onPress: () => stopParent(row) }]
        : []),
    ].map((action) => ({ ...action, disabled: busy || row.pid === process.pid }));

  const hints: Hint[] = [
    {
      key: 's',
      label: `sort: ${SORT_LABELS[sort]}`,
      onPress: () => changeSort(next(SORT_KEYS, sort)),
    },
    {
      key: 'f',
      label: `show: ${SCOPE_LABELS[scope]}`,
      onPress: () => changeScope(next(SCOPES, scope)),
    },
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
    ...(filter ? [{ key: 'Esc', label: 'clear', onPress: () => changeFilter('') }] : []),
  ];

  const compact = viewport.columns < 120;
  const totalCpu = rows.reduce((sum, row) => sum + row.cpu, 0);
  const header = prompt.line ?? (
    <Text color={busy ? colors.warn : colors.muted} wrap="truncate">
      {isLoading && !data
        ? 'Reading the process table…'
        : `${rows.length} of ${all.length} processes · ${totalCpu.toFixed(0)}% CPU shown${filter ? ` · matching "${filter}"` : ''}${scope === 'here' ? ` · in ${root}` : ''}`}
      {busy ? ' · working…' : ''}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <Box flexShrink={0} flexDirection="row">
        <ChipRow
          label="show"
          compact={compact}
          chips={SCOPES.map((id) => ({ id, label: SCOPE_LABELS[id], isOn: id === scope }))}
          onToggle={(id) => changeScope(id as Scope)}
        />
        <ChipRow
          label="sort"
          compact={compact}
          chips={SORT_KEYS.map((id) => ({ id, label: SORT_LABELS[id], isOn: id === sort }))}
          onToggle={(id) => changeSort(id as SortKey)}
        />
      </Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        //? Column headings, not a name: the tab already says which view this is, and the count is
        //? drawn at the right of this row by the list itself
        title={HEADER}
        items={items}
        emptyText={
          isLoading && !data
            ? 'Reading the process table…'
            : scope === 'here'
              ? `Nothing of yours is running in ${root}.`
              : 'No process matches.'
        }
        detailTitle="Process"
        reservedChrome={['viewHeader', 'chipRow']}
        activateLabel="stop"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => stop(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected[tab] = item?.id;
        }}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} />
              <Detail
                row={row}
                parent={all.find((proc) => proc.pid === row.ppid)}
                childCount={all.filter((proc) => proc.ppid === row.pid).length}
              />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default ProcessesView;

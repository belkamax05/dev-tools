import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail, { listTextWidth } from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  buildComparison,
  type CompareRow,
  cellVersion,
  discoverFolders,
  loadColumns,
  toAbsolute,
  toRelative,
} from '../../../core/compare';
import type { DependencyType } from '../../../config/settings';
import { detectPackageManager, setVersionCommand } from '../../../core/manifest';
import { compareVersions } from '../../../core/semver';
import type { ViewProps } from '../../types';

export type FolderSource = 'config' | 'saved' | 'found';

export interface OfferedFolder {
  /** As written: relative to the current folder, or absolute. */
  path: string;
  abs: string;
  source: FolderSource;
  hasManifest: boolean;
}

const fitEnd = (text: string, width: number) =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);

/** Paths keep their end — `…/apps/web` says more than `../../pro…`. */
const fitStart = (text: string, width: number) =>
  text.length > width ? `…${text.slice(text.length - Math.max(0, width - 1))}` : text.padEnd(width);

/** Which rows are on screen: `from` inclusive, `to` exclusive. */
export interface RowWindow {
  from: number;
  to: number;
}

/**
 * Lay the comparison out as a table that fits `width` cells: a header line and one line per row,
 * every `│` in the same column on every line.
 *
 * Sized from the rows in `visible` (every row when not given), so the columns fit what is on
 * screen and are laid out again as the list scrolls:
 *   1. each version column is exactly as wide as its longest visible version — never cut while
 *      there is any room at all;
 *   2. the package name gets what is left, up to the longest visible name, and is cut with `…`
 *      when that is too little;
 *   3. room still left goes to the folder headers, up to their full length — a header is cut
 *      from its start (`…/web`) before it widens a column past its versions.
 * Only when the versions alone don't fit does anything else give: the name stops at the width of
 * `PACKAGE`, then the widest version column is cut a cell at a time.
 */
export const layoutCompareTable = (
  headers: string[],
  rows: { name: string; versions: string[] }[],
  width: number,
  visible: RowWindow = { from: 0, to: rows.length },
): { header: string; lines: string[] } => {
  const shown = rows.slice(visible.from, visible.to);
  const widths = headers.map((_, at) =>
    Math.max(1, ...shown.map((row) => row.versions[at]?.length ?? 0)),
  );
  const versionsWidth = () => widths.reduce((sum, columnWidth) => sum + columnWidth + 3, 0);
  const longestName = Math.max('PACKAGE'.length, ...shown.map((row) => row.name.length));

  const smallestName = Math.min(longestName, 'PACKAGE'.length);
  while (smallestName + versionsWidth() > width) {
    const widest = Math.max(...widths);
    if (widest <= 1) break;
    widths[widths.indexOf(widest)] = widest - 1;
  }
  const nameWidth = Math.max(smallestName, Math.min(longestName, width - versionsWidth()));

  headers.forEach((header, at) => {
    const room = width - nameWidth - versionsWidth();
    const columnWidth = widths[at] ?? 0;
    if (room > 0 && header.length > columnWidth) {
      widths[at] = columnWidth + Math.min(room, header.length - columnWidth);
    }
  });

  const line = (name: string, cells: string[], fitCell: typeof fitEnd) =>
    fitEnd(name, nameWidth) +
    widths.map((columnWidth, at) => ` │ ${fitCell(cells[at] ?? '', columnWidth)}`).join('');
  return {
    header: line('PACKAGE', headers, fitStart),
    lines: rows.map((row) => line(row.name, row.versions, fitEnd)),
  };
};

const SECTION_LABEL: Record<DependencyType, string> = {
  dependencies: 'prod',
  devDependencies: 'dev',
  peerDependencies: 'peer',
  optionalDependencies: 'optional',
};

/** Where a folder stands against the newest version any folder has. */
export type CellStanding = 'newest' | 'behind' | 'same' | 'missing' | 'unknown';

export const cellStanding = (row: CompareRow, at: number): CellStanding => {
  const cell = row.cells[at];
  const version = cellVersion(cell);
  if (!cell) return 'missing';
  if (!version || !row.highest) return 'unknown';
  const highest = row.highest;
  //? "Newest" only means something beside a folder that is behind — a row that differs only
  //? because some folder lacks the package has nothing to rank
  const anyBehind = row.cells.some((other) => {
    const otherVersion = cellVersion(other);
    return otherVersion !== undefined && compareVersions(otherVersion, highest) < 0;
  });
  if (!anyBehind) return 'same';
  return compareVersions(version, highest) < 0 ? 'behind' : 'newest';
};

/**
 * One sentence on what the row means, for someone who has not read the table yet: the same
 * everywhere, or who is behind the newest version and where that newest version is, and which
 * folders do not have the package at all.
 */
export const summarizeRow = (row: CompareRow, labels: string[]): string => {
  const where = (standing: CellStanding) =>
    labels.filter((_, at) => cellStanding(row, at) === standing);
  const missing = where('missing');
  const missingNote = missing.length ? `not a dependency in ${missing.join(', ')}` : '';
  if (!row.differs) return `Same version everywhere: ${row.highest ?? '?'}`;
  const behind = where('behind');
  const parts = [
    behind.length
      ? `Behind the newest ${row.highest} (${where('newest').join(', ')}): ${behind.join(', ')}`
      : `On ${row.highest} wherever it is declared`,
    missingNote,
  ];
  return parts.filter(Boolean).join(' · ');
};

const STANDING_MARK: Record<CellStanding, string> = {
  newest: ' ★',
  behind: ' ↓',
  same: '',
  missing: '',
  unknown: '',
};

/**
 * The detail pane of the comparison: a sentence saying what the row means, then one labelled line
 * per folder — installed version, declared range and section — and a key for the marks.
 */
const CompareDetail = ({ row, labels }: { row: CompareRow; labels: string[] }) => {
  const colors = useColors();
  const lines = labels.map((label, at) => {
    const cell = row.cells[at];
    const standing = cellStanding(row, at);
    return {
      label,
      standing,
      installed: cell ? `${cell.installed ?? 'not installed'}${STANDING_MARK[standing]}` : '—',
      declared: cell ? cell.range : '—',
      section: cell ? SECTION_LABEL[cell.type] : 'not a dependency',
    };
  });
  const width = (values: string[], heading: string) =>
    Math.max(heading.length, ...values.map((value) => value.length)) + 2;
  const folderWidth = width(labels, 'FOLDER');
  const installedWidth = width(
    lines.map((line) => line.installed),
    'INSTALLED',
  );
  const declaredWidth = width(
    lines.map((line) => line.declared),
    'DECLARED',
  );
  const standingColor = (standing: CellStanding) =>
    standing === 'behind'
      ? colors.warn
      : standing === 'newest' || standing === 'same'
        ? colors.ok
        : colors.muted;

  return (
    <Box flexDirection="column">
      <Text bold color={colors.heading} wrap="truncate">
        {row.name}
      </Text>
      <Text color={row.differs ? colors.warn : colors.ok} wrap="wrap">
        {summarizeRow(row, labels)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={colors.muted} bold wrap="truncate">
          {`${'FOLDER'.padEnd(folderWidth)}${'INSTALLED'.padEnd(installedWidth)}${'DECLARED'.padEnd(declaredWidth)}SECTION`}
        </Text>
        {lines.map((line, at) => (
          <Text key={line.label} wrap="truncate">
            <Text color={at === 0 ? colors.accent : colors.text}>
              {line.label.padEnd(folderWidth)}
            </Text>
            <Text color={standingColor(line.standing)}>
              {line.installed.padEnd(installedWidth)}
            </Text>
            <Text color={colors.text}>{line.declared.padEnd(declaredWidth)}</Text>
            <Text color={colors.muted}>{line.section}</Text>
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.muted} wrap="wrap">
          ★ newest · ↓ behind the newest · INSTALLED is what node_modules has, DECLARED the range in
          package.json · here is the folder pkgi was started in
        </Text>
      </Box>
    </Box>
  );
};

const SOURCE_LABEL: Record<FolderSource, string> = {
  config: 'pkgi.config.ts',
  saved: 'saved',
  found: 'nearby',
};

/**
 * Every folder the Compare tab can offer: the config file's, the ones saved from the dashboard,
 * and the ones found nearby (workspace members, sibling projects) — each once, first source
 * winning, so a saved folder is never offered again as "nearby".
 */
export const offeredFolders = (
  dir: string,
  configPaths: string[],
  savedPaths: string[],
): OfferedFolder[] => {
  const seen = new Set<string>([dir]);
  const out: OfferedFolder[] = [];
  const add = (path: string, source: FolderSource) => {
    const abs = toAbsolute(dir, path);
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ path, abs, source, hasManifest: existsSync(join(abs, 'package.json')) });
  };
  for (const path of configPaths) add(path, 'config');
  for (const path of savedPaths) add(path, 'saved');
  for (const abs of discoverFolders(dir)) add(toRelative(dir, abs), 'found');
  return out;
};

/**
 * This folder's packages beside other folders' — the web page's compare mode.
 *
 * Which folders is a question asked in a picker first (the dialog the page opened), answered from
 * a list rather than by typing paths: what `pkgi.config.ts` names, what was saved here before, and
 * what sits nearby. The ticked set is remembered per folder, so the next visit opens straight on
 * the comparison.
 */
export const CompareView = ({
  dir,
  context,
  session,
  notify,
  onCaptureInput,
  runCommands,
  updateState,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const configPaths = context.project.config.comparePaths ?? [];
  //? Scans the parent folder and the workspace, so only when the lists it starts from change
  // biome-ignore lint/correctness/useExhaustiveDependencies: the joined lists are the identity
  const offered = useMemo(
    () => offeredFolders(dir, configPaths, context.state.comparePaths),
    [dir, configPaths.join('|'), context.state.comparePaths.join('|'), refreshKey],
  );
  const selection = context.state.compareSelection.filter((path) =>
    offered.some((folder) => folder.path === path && folder.hasManifest),
  );
  const [picking, setPicking] = useState(selection.length === 0);
  const [onlyDifferent, setOnlyDifferent] = useState(session.onlyDifferent);
  const [filter, setFilter] = useState(session.compareFilter ?? '');
  const viewport = useViewport();
  const theme = useTuiTheme();
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.compare);
  const [pickId, setPickId] = useState<string | undefined>(undefined);
  //? The rows the list has on screen — the table is sized to them, and again on every scroll
  const [rowWindow, setRowWindow] = useState<RowWindow | undefined>(undefined);

  const selectionKey = selection.join('|');
  const { data: loaded, isLoading } = useLoader(async () => {
    if (!selection.length) return undefined;
    const dirs = [dir, ...selection.map((path) => toAbsolute(dir, path))];
    const [columns, managers] = await Promise.all([
      loadColumns(dir, dirs),
      Promise.all(dirs.map((at) => detectPackageManager(at))),
    ]);
    return { columns, managers };
  }, [dir, selectionKey, refreshKey]);

  const columns = loaded?.columns ?? [];
  const comparison = buildComparison(columns);
  const rows = comparison.filter(
    (row) =>
      (!onlyDifferent || row.differs) &&
      (!filter || row.name.toLowerCase().includes(filter.toLowerCase())),
  );
  const changeFilter = (value: string) => {
    setFilter(value);
    session.compareFilter = value;
  };
  const askFilter = () =>
    prompt.ask('Filter packages:', (value) => changeFilter(value.trim()), { initial: filter });
  const current = rows.find((row) => row.name === currentId);

  // — the folder picker —

  const toggle = (folder: OfferedFolder | undefined) => {
    if (!folder) return;
    if (!folder.hasManifest) {
      notify(`${folder.path} has no package.json`, 'warn');
      return;
    }
    updateState((state) => {
      const ticked = new Set(state.compareSelection);
      if (ticked.has(folder.path)) ticked.delete(folder.path);
      else ticked.add(folder.path);
      state.compareSelection = [...ticked];
      return state;
    });
  };

  const save = (folder: OfferedFolder | undefined) => {
    if (!folder || folder.source !== 'found') return;
    updateState((state) => {
      state.comparePaths = [...new Set([...state.comparePaths, folder.path])];
      return state;
    });
    notify(`Saved ${folder.path} to this folder's compare list`, 'ok');
  };

  const forget = (folder: OfferedFolder | undefined) => {
    if (!folder) return;
    if (folder.source === 'config') {
      notify(`${folder.path} comes from pkgi.config.ts — remove it there`, 'warn');
      return;
    }
    if (folder.source !== 'saved') return;
    updateState((state) => {
      state.comparePaths = state.comparePaths.filter((path) => path !== folder.path);
      state.compareSelection = state.compareSelection.filter((path) => path !== folder.path);
      return state;
    });
  };

  const addPath = () =>
    prompt.ask('Folder to compare with (relative or absolute):', (value) => {
      const path = value.trim();
      if (!path) return;
      const abs = toAbsolute(dir, path);
      if (!existsSync(join(abs, 'package.json'))) {
        notify(`${abs} has no package.json`, 'error');
        return;
      }
      const written = toRelative(dir, abs);
      updateState((state) => {
        state.comparePaths = [...new Set([...state.comparePaths, written])];
        state.compareSelection = [...new Set([...state.compareSelection, written])];
        return state;
      });
      notify(`Added ${written}`, 'ok');
    });

  const done = () => {
    if (!selection.length) {
      notify('Tick at least one folder to compare with', 'warn');
      return;
    }
    setPicking(false);
  };

  const pickFolder = offered.find((folder) => folder.abs === pickId);

  useInput(
    (input, key) => {
      if (picking) {
        if (input === ' ') toggle(pickFolder);
        else if (input === 'c' || key.escape) done();
        else if (input === 'a') addPath();
        else if (input === 's') save(pickFolder);
        else if (input === 'x') forget(pickFolder);
        return;
      }
      if (input === 'p' || input === 'f') setPicking(true);
      else if (input === '/') askFilter();
      else if (key.escape && filter) changeFilter('');
      else if (input === 'd') {
        setOnlyDifferent((was) => {
          session.onlyDifferent = !was;
          return !was;
        });
      } else if (input === 'a' && current) align(current);
      else if (input === 'u' && current) alignHere(current);
    },
    { isActive: !prompt.isOpen },
  );

  // — the comparison —

  const behind = (row: CompareRow) =>
    columns.flatMap((column, at) => {
      const cell = row.cells[at];
      const version = cellVersion(cell);
      if (!cell || cell.local || !version || !row.highest) return [];
      return compareVersions(version, row.highest) < 0 ? [{ column, at, cell }] : [];
    });

  const align = (row: CompareRow) => {
    const targets = behind(row);
    if (!targets.length || !row.highest) {
      notify(
        `${row.name} is already on ${row.highest ?? 'the same version'} everywhere it is declared`,
      );
      return;
    }
    const highest = row.highest;
    const commands = targets.flatMap(({ column, at, cell }) => [
      ['cd', column.dir],
      setVersionCommand(
        loaded?.managers[at]?.name ?? 'npm',
        row.name,
        highest,
        cell.type,
        cell.range,
      ),
    ]);
    prompt.confirm(
      `Move ${row.name} to ${highest} in ${targets.map(({ column }) => column.label).join(', ')}?`,
      () => runCommands(commands, `${row.name} → ${highest} in ${targets.length} folder(s)`),
    );
  };

  const alignHere = (row: CompareRow) => {
    const here = behind(row).find(({ at }) => at === 0);
    if (!here || !row.highest) {
      notify(`${row.name} here is not behind the other folders`);
      return;
    }
    const highest = row.highest;
    const command = setVersionCommand(
      loaded?.managers[0]?.name ?? 'npm',
      row.name,
      highest,
      here.cell.type,
      here.cell.range,
    );
    prompt.confirm(`Move ${row.name} here to ${highest}?`, () =>
      runCommands([command], `${row.name} → ${highest}`),
    );
  };

  if (picking) {
    const groups: [string, OfferedFolder[]][] = [
      ['From pkgi.config.ts', offered.filter((folder) => folder.source === 'config')],
      ['Saved for this folder', offered.filter((folder) => folder.source === 'saved')],
      ['Found nearby', offered.filter((folder) => folder.source === 'found')],
    ];
    const items: PickItem<OfferedFolder>[] = groups.flatMap(([title, folders]) =>
      folders.length
        ? [
            { id: `header-${title}`, label: `${title} (${folders.length})`, isHeader: true },
            ...folders.map((folder) => {
              const ticked = selection.includes(folder.path);
              return {
                id: folder.abs,
                label: folder.path,
                hint: folder.hasManifest ? SOURCE_LABEL[folder.source] : 'no package.json',
                hintColor: folder.hasManifest ? undefined : colors.error,
                disabled: !folder.hasManifest,
                controls: [
                  {
                    id: 'tick',
                    glyph: ticked ? '[×]' : '[ ]',
                    color: ticked ? colors.accent : colors.muted,
                    onPress: () => toggle(folder),
                  },
                ],
                value: folder,
              };
            }),
          ]
        : [],
    );
    const hints: Hint[] = [
      { key: 'Space', label: 'tick', onPress: () => toggle(pickFolder) },
      { key: 'a', label: 'add path', onPress: addPath },
      { key: 'c', label: `compare ${selection.length}`, onPress: done },
    ];
    return (
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <Box flexShrink={0}>
          {prompt.line ?? (
            <Text color={colors.accent} wrap="truncate">
              {`Compare ${dir} with… ${selection.length} ticked · Esc or [c] when done`}
            </Text>
          )}
        </Box>
        <ListDetail
          title="Folders"
          items={items}
          emptyText="Nothing found nearby — [a] adds a folder by path."
          detailTitle="Folder"
          reservedChrome={['viewHeader']}
          activateLabel="tick"
          isInputActive={!prompt.isOpen}
          hints={hints}
          onActivate={(item) => toggle(item.value)}
          onSelectionChange={(item) => setPickId(item?.id)}
          renderDetail={(item) => {
            const folder = item?.value;
            if (!folder) return null;
            const ticked = selection.includes(folder.path);
            return (
              <Box flexDirection="column">
                <Toolbar
                  actions={[
                    {
                      hotkey: 'Space',
                      label: ticked ? 'Untick' : 'Tick',
                      onPress: () => toggle(folder),
                      tone: 'primary',
                      isOn: ticked,
                    },
                    ...(folder.source === 'found'
                      ? [{ hotkey: 's', label: 'Save to list', onPress: () => save(folder) }]
                      : []),
                    ...(folder.source === 'saved'
                      ? [
                          {
                            hotkey: 'x',
                            label: 'Forget',
                            onPress: () => forget(folder),
                            tone: 'danger' as const,
                          },
                        ]
                      : []),
                    { hotkey: 'c', label: `Compare ${selection.length}`, onPress: done },
                  ]}
                />
                <Text bold color={colors.heading}>
                  {folder.path}
                </Text>
                <Text color={colors.muted} wrap="truncate-start">
                  {folder.abs}
                </Text>
                <Box marginTop={1}>
                  <Text color={colors.muted} wrap="wrap">
                    {folder.source === 'config'
                      ? 'Listed in pkgi.config.ts — offered to everyone who runs pkgi here.'
                      : folder.source === 'saved'
                        ? "Saved from the dashboard to this folder's state."
                        : 'A workspace member or a sibling project next to this folder. [s] keeps it on the list.'}
                  </Text>
                </Box>
              </Box>
            );
          }}
        />
      </Box>
    );
  }

  const folderLabels = columns.map((column, at) => (at === 0 ? 'here' : column.label));
  //? Room the table may take: the list's text width less, on the rows, the one-cell hint and its
  //? space, and on the header, the `n/n` position the list draws at the right of its title row
  const badge = `${rows.length}/${rows.length}`.length + 1;
  const table = layoutCompareTable(
    folderLabels,
    rows.map((row) => ({
      name: row.name,
      //? A range with no version in it (`latest`, a tag) is shown as declared, not as a blank
      versions: row.cells.map((cell) => (cell ? cellVersion(cell) || cell.range : '—')),
    })),
    listTextWidth(viewport.columns, theme) - Math.max(2, badge),
    rowWindow,
  );
  const items: PickItem<CompareRow>[] = rows.map((row, at) => ({
    id: row.name,
    label: table.lines[at] ?? row.name,
    //? A one-cell hint on every row, so every label gets the same room and the columns line up
    hint: row.differs ? '≠' : '=',
    hintColor: row.differs ? colors.warn : colors.muted,
    value: row,
  }));

  const differing = comparison.filter((row) => row.differs).length;
  const hints: Hint[] = [
    { key: 'p', label: 'folders', onPress: () => setPicking(true) },
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
    ...(filter ? [{ key: 'Esc', label: 'clear', onPress: () => changeFilter('') }] : []),
    {
      key: 'd',
      label: onlyDifferent ? 'show all' : `only different (${differing})`,
      onPress: () =>
        setOnlyDifferent((was) => {
          session.onlyDifferent = !was;
          return !was;
        }),
    },
  ];

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            {isLoading && !loaded
              ? 'Reading every folder…'
              : `${rows.length} of ${comparison.length} packages · ${differing} differ${
                  filter ? ` · matching "${filter}"` : ''
                } · here = ${dir}`}
          </Text>
        )}
      </Box>
      <ListDetail
        key={`${onlyDifferent}|${filter}|${selectionKey}|${rows.length}`}
        //? The column headings, drawn by the list from the cell its rows' cursor marker starts in
        title={`  ${table.header}`}
        items={items}
        emptyText={
          isLoading
            ? 'Reading every folder…'
            : filter
              ? 'No package matches the filter.'
              : onlyDifferent
                ? 'No differences.'
                : 'No packages.'
        }
        detailTitle={current?.name ?? 'Package'}
        reservedChrome={['viewHeader']}
        activateLabel="align"
        activateOnClick={false}
        onWindowChange={(from, to) =>
          setRowWindow((was) => (was?.from === from && was.to === to ? was : { from, to }))
        }
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => item.value && align(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.compare = item?.id;
        }}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          const targets = behind(row);
          return (
            <Box flexDirection="column">
              <Toolbar
                actions={[
                  ...(targets.length && row.highest
                    ? [
                        {
                          hotkey: 'a',
                          label: `Align ${targets.length} → ${row.highest}`,
                          onPress: () => align(row),
                          tone: 'primary' as const,
                        },
                      ]
                    : []),
                  ...(targets.some(({ at }) => at === 0) && row.highest
                    ? [
                        {
                          hotkey: 'u',
                          label: `Here → ${row.highest}`,
                          onPress: () => alignHere(row),
                        },
                      ]
                    : []),
                  { hotkey: 'p', label: 'Folders…', onPress: () => setPicking(true) },
                ]}
              />
              <CompareDetail row={row} labels={folderLabels} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default CompareView;

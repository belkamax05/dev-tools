import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  buildComparison,
  type CompareRow,
  cellVersion,
  discoverFolders,
  loadColumns,
  toAbsolute,
  toRelative,
} from '../../../core/compare';
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
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.compare);
  const [pickId, setPickId] = useState<string | undefined>(undefined);

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
  const rows = onlyDifferent ? comparison.filter((row) => row.differs) : comparison;
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

  const items: PickItem<CompareRow>[] = rows.map((row) => ({
    id: row.name,
    label: `${row.differs ? '≠' : ' '} ${row.name}`,
    hint: row.cells.map((cell) => cellVersion(cell) ?? '—').join(' │ '),
    hintColor: row.differs ? colors.warn : colors.muted,
    value: row,
  }));

  const differing = comparison.filter((row) => row.differs).length;
  const hints: Hint[] = [
    { key: 'p', label: 'folders', onPress: () => setPicking(true) },
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
              : `${columns.map((column) => column.label).join(' │ ')} · ${comparison.length} packages · ${differing} differ`}
          </Text>
        )}
      </Box>
      <ListDetail
        key={`${onlyDifferent}|${selectionKey}|${rows.length}`}
        title={`Compare (${rows.length})`}
        items={items}
        emptyText={
          isLoading ? 'Reading every folder…' : onlyDifferent ? 'No differences.' : 'No packages.'
        }
        detailTitle={current?.name ?? 'Package'}
        reservedChrome={['viewHeader']}
        activateLabel="align"
        activateOnClick={false}
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
          const labelWidth = Math.max(8, ...columns.map((column) => column.label.length)) + 2;
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
              <Text bold color={colors.heading}>
                {row.name}
              </Text>
              {columns.map((column, at) => {
                const cell = row.cells[at];
                const version = cellVersion(cell);
                const isHighest = version && version === row.highest;
                return (
                  <Box key={column.dir} flexDirection="row">
                    <Box width={labelWidth} flexShrink={0}>
                      <Text color={at === 0 ? colors.accent : colors.muted} wrap="truncate">
                        {column.label}
                      </Text>
                    </Box>
                    <Text
                      color={!cell ? colors.muted : isHighest ? colors.ok : colors.warn}
                      wrap="truncate"
                    >
                      {cell
                        ? `${version ?? '?'}${cell.installed ? '' : ' (not installed)'}  ${cell.range} · ${cell.type}${isHighest && row.differs ? ' ★' : ''}`
                        : '— not declared'}
                    </Text>
                  </Box>
                );
              })}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default CompareView;

import { Text, useInput } from 'ink';
import { useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useDebouncedCallback from '@/dev-tools/ui/hooks/useDebouncedCallback';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import type { DependencyType } from '../../../config/settings';
import type { SupportInfo } from '../../../core/eol';
import {
  addCommand,
  readManifest,
  removeCommand,
  setVersionCommand,
  shellQuote,
} from '../../../core/manifest';
import { buildRows, fetchInfos, isOutdated, type PackageRow } from '../../../core/packages';
import { type SearchResult, searchPackages } from '../../../core/registry';
import { isPrerelease, majorDistance } from '../../../core/semver';
import { getManyPackageSupport, isUnsupported, supportLabel } from '../../../core/support';
import {
  addActions,
  PackageDetail,
  RegistryPackageDetail,
  type SupportColors,
  supportColor,
} from '../../PackageDetail';
import type { ViewProps } from '../../types';
import VersionPicker from '../../VersionPicker';

export { supportColor };

type Colors = ReturnType<typeof useColors>;

/** A list entry: a package the folder has, or a registry match it could add. */
type Entry = { kind: 'installed'; row: PackageRow } | { kind: 'registry'; result: SearchResult };

export const TYPE_LABELS: Record<DependencyType, string> = {
  dependencies: 'Dependencies',
  devDependencies: 'Dev dependencies',
  peerDependencies: 'Peer dependencies',
  optionalDependencies: 'Optional dependencies',
};

export const packageColor = (
  row: Pick<PackageRow, 'deprecated'>,
  support: SupportInfo | undefined,
  colors: SupportColors,
) => (row.deprecated ? colors.error : supportColor(support, colors));

export const supportGroup = (row: Pick<PackageRow, 'deprecated'>, support?: SupportInfo) =>
  row.deprecated || isUnsupported(support)
    ? 'attention'
    : support?.status === 'supported'
      ? 'supported'
      : 'unknown';

export const registryUpdateAge = (modified?: string, now = Date.now()): string => {
  const date = modified ? Date.parse(modified) : Number.NaN;
  if (!Number.isFinite(date)) return 'Publish date unavailable';
  const days = Math.max(0, Math.floor((now - date) / 86400000));
  return (
    modified?.slice(0, 10) + ' · ' + (days === 0 ? 'today' : days + ' days ago') + ' (npm publish)'
  );
};

/** Text glyphs need Unicode support, not an image protocol or a special icon font. */
export const packageIconsSupported = (
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
) =>
  env.TERM !== 'dumb' &&
  (platform !== 'win32' ||
    Boolean(env.WT_SESSION || env.TERM_PROGRAM || env.TERM === 'xterm-256color'));

export const updateIndicator = (
  row: Pick<PackageRow, 'local' | 'update' | 'latest' | 'prerelease' | 'info'>,
  unicode: boolean,
) => {
  if (row.local) return unicode ? '−' : '-';
  if (row.update !== 'none' && row.latest) return unicode ? '↑' : 'U';
  if (row.prerelease) return unicode ? '⇡' : 'P';
  if (!row.info || row.info.error || !row.latest) return '?';
  return '=';
};

export const updateIndicatorColor = (
  row: Pick<PackageRow, 'local' | 'update' | 'latest' | 'prerelease'>,
  colors: Pick<Colors, 'error' | 'warn' | 'ok' | 'muted' | 'highlight'>,
) => {
  if (row.local) return colors.muted;
  if (row.latest && row.update === 'major') return colors.error;
  if (row.latest && row.update === 'minor') return colors.warn;
  if (row.latest && row.update === 'patch') return colors.ok;
  if (row.prerelease) return colors.highlight;
  return colors.muted;
};

const rowHint = (row: PackageRow, support: SupportInfo | undefined, checking: boolean) => {
  if (row.local) return row.range;
  const parts = [row.installed ?? `${row.range} · not installed`];
  if (row.update !== 'none' && row.latest) {
    const jump = row.update === 'major' ? majorDistance(row.current, row.latest) : 0;
    parts.push(`→ ${row.latest}${jump > 1 ? ` (+${jump} majors)` : ''}`);
  } else if (row.prerelease) parts.push(`→ ${row.prerelease}`);
  else if (!row.info && checking) parts.push('…');
  if (row.info?.error === 'not-found') parts.push('not on registry');
  if (row.deprecated) parts.push('⚠ deprecated');
  if (support?.status === 'eol' || support?.status === 'stale')
    parts.push(`⚠ ${supportLabel(support)}`);
  else if (support) parts.push(supportLabel(support));
  if (row.mismatch) parts.push('≠ declared');
  if (row.note) parts.push('✎');
  return parts.join(' ');
};

/**
 * The folder's dependencies — declared range, installed version, latest on the registry — with
 * update, version pick, removal and a note per package. The Dependencies page of the old web app,
 * on the current directory instead of a configured repository.
 *
 * `package.json` and `node_modules` are read first and shown at once; the registry answers stream
 * in after (from the cache when it is fresh), so a slow network never blanks the list.
 */
export const PackagesView = ({
  dir,
  context,
  manager,
  session,
  notify,
  onCaptureInput,
  runCommands,
  updateState,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const { settings } = context;
  const prompt = usePrompt(onCaptureInput);
  const [filter, setFilter] = useState(session.filter);
  const [onlyOutdated, setOnlyOutdated] = useState(session.onlyOutdated);
  const [supportMode, setSupportMode] = useState(session.supportMode ?? false);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.packages);
  const [picker, setPicker] = useState(session.picker?.mode === 'set' ? session.picker : undefined);
  //? The registry is asked once typing settles, later than the local filter narrows
  const [searchTerm, setSearchTerm] = useState(session.filter);
  const settleSearch = useDebouncedCallback(setSearchTerm, 350);
  /** A version picker for a registry suggestion — kept out of `session.picker`, which the Add tab restores. */
  const [addPicker, setAddPicker] = useState<string | undefined>();
  /** Versions picked for registry suggestions — "Other version…" is a dropdown, not an install. */
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const choose = (name: string, version: string | undefined) =>
    setChosen(({ [name]: _was, ...rest }) => (version ? { ...rest, [name]: version } : rest));
  const [check, setCheck] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>();
  const force = useRef(false);
  //? Set by [c] alone: a check asked for by hand reports in the status line as it goes and when
  //? it is done, where the automatic one on opening only shows in the header
  const announce = useRef(false);

  const { data: manifest, isLoading: isReading } = useLoader(
    () => readManifest(dir, settings.dependencyTypes),
    [dir, settings.dependencyTypes.join(','), refreshKey],
  );
  const registryNames = (manifest?.dependencies ?? [])
    .filter((dep) => !dep.local)
    .map((dep) => dep.name)
    .join(',');
  const { data: infos, isLoading: isChecking } = useLoader(async () => {
    if (!manifest) return {};
    const result = await fetchInfos(manifest, settings, {
      force: force.current,
      onProgress: (done, total) => {
        setProgress({ done, total });
        if (announce.current) notify(`Asking the registry… ${done}/${total}`);
      },
    });
    setProgress(undefined);
    if (announce.current) {
      announce.current = false;
      const answers = Object.values(result);
      //? `not-found` is an answer — a private or local package — not a failure to ask
      const failed = answers.filter((info) => info?.error && info.error !== 'not-found').length;
      notify(
        failed
          ? `Checked ${answers.length} packages — ${failed} could not be read from the registry`
          : `Checked ${answers.length} packages against the registry`,
        failed ? 'warn' : 'ok',
      );
    }
    return result;
  }, [registryNames, settings.registry, settings.cacheHours, check]);

  const rows = manifest ? buildRows(manifest, infos ?? {}, context.state.notes, settings) : [];
  //? Re-judged when a version in use or a registry answer changes — the registry-based verdict
  //? needs `latest` and the last publish date, so it waits for those
  const supportKey = rows
    .filter((row) => !row.local)
    .map((row) => `${row.name}@${row.current}>${row.latest ?? ''}/${row.info?.modified ?? ''}`)
    .join(',');
  const { data: support = {} } = useLoader(async () => {
    const result = await getManyPackageSupport(
      rows.filter((row) => !row.local),
      { registry: settings.registry, force: force.current },
    );
    force.current = false;
    return result;
  }, [supportKey, settings.registry, check]);

  const visible = rows.filter(
    (row) =>
      (!onlyOutdated || isOutdated(row) || row.deprecated) &&
      (!filter ||
        row.name.toLowerCase().includes(filter.toLowerCase()) ||
        row.note?.toLowerCase().includes(filter.toLowerCase())),
  );
  const current = visible.find((row) => row.name === currentId);

  //? A filter is also a search: packages the folder does not have yet, to add from here
  const searching = !onlyOutdated && searchTerm.length >= 2 && filter.length >= 2;
  const { data: found = [], isLoading: isSearching } = useLoader(
    () =>
      searching ? searchPackages(searchTerm, settings.registry) : Promise.resolve([] as SearchResult[]),
    [searching ? searchTerm : '', settings.registry],
  );
  const declaredNames = new Set(rows.map((row) => row.name));
  const suggestions = searching
    ? found.filter(
        (result) =>
          !declaredNames.has(result.name) &&
          (settings.showUnstable || !isPrerelease(result.version)),
      )
    : [];
  const currentResult = current
    ? undefined
    : suggestions.find((result) => result.name === currentId);

  const unicodeIcons = packageIconsSupported();
  const groups = supportMode
    ? [
        { id: 'attention', label: 'Needs attention · EOL / ending / stale / deprecated' },
        { id: 'supported', label: 'Supported' },
        { id: 'unknown', label: 'No confirmed EOL information' },
      ]
    : settings.dependencyTypes.map((type) => ({ id: type, label: TYPE_LABELS[type] }));
  const items: PickItem<Entry>[] = groups.flatMap(({ id, label }) => {
    const group = visible.filter((row) =>
      supportMode ? supportGroup(row, support[row.name]) === id : row.type === id,
    );
    if (!group.length) return [];
    return [
      { id: `header-${id}`, label: `${label} (${group.length})`, isHeader: true },
      ...group.map((row) => ({
        id: row.name,
        label: row.name,
        prefix: {
          text: updateIndicator(row, unicodeIcons),
          color: updateIndicatorColor(row, colors),
        },
        hint: rowHint(row, support[row.name], isChecking),
        hintColor: packageColor(row, support[row.name], colors),
        value: { kind: 'installed' as const, row },
      })),
    ];
  });
  if (suggestions.length)
    items.push(
      {
        id: 'header-registry',
        label: `On the registry (${suggestions.length})${isSearching ? ' · searching…' : ''}`,
        isHeader: true,
      },
      ...suggestions.map((result) => ({
        id: result.name,
        label: result.name,
        prefix: { text: '+', color: colors.accent },
        hint: result.version,
        hintColor: colors.muted,
        value: { kind: 'registry' as const, result },
      })),
    );

  const setVersion = (row: PackageRow, version: string) => {
    const command = setVersionCommand(manager.name, row.name, version, row.type, row.range);
    prompt.confirm(`${row.current} → ${version}: ${shellQuote(command)}?`, () =>
      runCommands([command], `${row.name} ${row.current} → ${version}`),
    );
  };

  const update = (row: PackageRow | undefined) => {
    if (!row || row.local) return;
    if (row.update === 'none' || !row.latest) {
      notify(
        `${row.name} is on the latest version${row.prerelease ? ' — [U] for the prerelease' : ''}`,
      );
      return;
    }
    setVersion(row, row.latest);
  };

  const updatePrerelease = (row: PackageRow | undefined) => {
    if (!row?.prerelease) {
      notify(
        settings.showUnstable
          ? 'No newer prerelease'
          : 'Prereleases are hidden — turn them on in Settings',
      );
      return;
    }
    setVersion(row, row.prerelease);
  };

  /**
   * Everything behind by a minor or a patch, in one go. Majors are left out on purpose — each is
   * a migration to read the notes for, not something to take in bulk.
   */
  const updateSafe = () => {
    const safe = rows.filter(
      (row) => !row.local && row.latest && (row.update === 'minor' || row.update === 'patch'),
    );
    if (!safe.length) {
      notify('Nothing behind by only a minor or patch');
      return;
    }
    const commands = safe.map((row) =>
      setVersionCommand(manager.name, row.name, row.latest as string, row.type, row.range),
    );
    prompt.confirm(
      `Update ${safe.length} package(s) with minor/patch updates (majors skipped)?`,
      () => runCommands(commands, `${safe.length} minor/patch update(s)`),
    );
  };

  const remove = (row: PackageRow | undefined) => {
    if (!row) return;
    const command = removeCommand(manager.name, [row.name]);
    prompt.confirm(`Remove ${row.name}: ${shellQuote(command)}?`, () =>
      runCommands([command], `removed ${row.name}`),
    );
  };

  const editNote = (row: PackageRow | undefined) => {
    if (!row) return;
    prompt.ask(
      `Note on ${row.name} (empty removes it):`,
      (value) => {
        const note = value.trim();
        updateState((state) => {
          if (note) state.notes[row.name] = { note, updatedAt: new Date().toISOString() };
          else delete state.notes[row.name];
          return state;
        });
        notify(note ? `Noted on ${row.name}` : `Removed the note on ${row.name}`, 'ok');
      },
      { initial: row.note ?? '' },
    );
  };

  const openPicker = (row: PackageRow | undefined) => {
    if (!row || row.local) return;
    const next = { name: row.name, mode: 'set' as const };
    setPicker(next);
    session.picker = next;
  };
  const closePicker = () => {
    setPicker(undefined);
    session.picker = undefined;
  };

  const add = (
    name: string | undefined,
    version?: string,
    dev = settings.installAs === 'dev',
  ) => {
    if (!name) return;
    const type = dev ? 'devDependencies' : 'dependencies';
    const command = addCommand(manager.name, name, version, type);
    prompt.confirm(`${shellQuote(command)}?`, () =>
      runCommands([command], `added ${name}${version ? `@${version}` : ''}`),
    );
  };

  const checkNow = () => {
    force.current = true;
    announce.current = true;
    setCheck((count) => count + 1);
    notify('Asking the registry for every package…');
  };

  const toggleSupportMode = () => {
    setSupportMode((was) => {
      session.supportMode = !was;
      return !was;
    });
  };

  const toggleOutdated = () => {
    setOnlyOutdated((was) => {
      session.onlyOutdated = !was;
      return !was;
    });
  };

  const changeFilter = (value: string) => {
    setFilter(value);
    session.filter = value;
    settleSearch(value);
  };
  const liveFilter = useDebouncedCallback((value: string) => changeFilter(value.trim()), 150);
  //? Narrows as you type; Esc puts back the filter that was there before
  const askFilter = () =>
    prompt.ask(
      'Filter (name or note):',
      (value) => {
        liveFilter.cancel();
        changeFilter(value.trim());
      },
      {
        initial: filter,
        onChange: liveFilter,
        onCancel: () => {
          liveFilter.cancel();
          changeFilter(filter);
        },
      },
    );

  useInput(
    (input, key) => {
      const name = current?.name ?? currentResult?.name;
      if (input === 'u') update(current);
      else if (input === 'U') updatePrerelease(current);
      else if (input === 'A') updateSafe();
      else if (input === 'v') {
        if (currentResult) setAddPicker(currentResult.name);
        else openPicker(current);
      } else if (input === 'x') remove(current);
      else if (input === 'n') editNote(current);
      else if (input === 'i' && currentResult)
        add(currentResult.name, chosen[currentResult.name], false);
      else if (input === 'd' && currentResult)
        add(currentResult.name, chosen[currentResult.name], true);
      else if (input === 'l' && currentResult) choose(currentResult.name, undefined);
      else if (input === 's' && current && chosen[current.name])
        setVersion(current, chosen[current.name] as string);
      else if (input === 'r' && current) choose(current.name, undefined);
      else if (input === 'w' && name) openUrl(`https://www.npmjs.com/package/${name}`);
      else if (input === 'o') toggleOutdated();
      else if (input === 'e') toggleSupportMode();
      else if (input === 'c') checkNow();
      else if (input === '/') askFilter();
      else if (key.escape && filter) changeFilter('');
    },
    { isActive: !prompt.isOpen && !picker && !addPicker },
  );

  if (addPicker) {
    return (
      <VersionPicker
        name={addPicker}
        registry={settings.registry}
        cacheHours={settings.cacheHours}
        showUnstable={settings.showUnstable}
        initialVersion={chosen[addPicker]}
        verb="choose"
        onPick={(version) => {
          setAddPicker(undefined);
          choose(addPicker, version);
        }}
        onClose={() => setAddPicker(undefined)}
      />
    );
  }

  const pickedRow = picker && rows.find((row) => row.name === picker.name);
  if (picker && pickedRow) {
    return (
      <VersionPicker
        name={pickedRow.name}
        current={pickedRow.current}
        initialVersion={chosen[pickedRow.name]}
        registry={settings.registry}
        cacheHours={settings.cacheHours}
        showUnstable={settings.showUnstable}
        verb="choose"
        onPick={(version) => {
          closePicker();
          //? The version in use is no choice at all: nothing to switch to
          choose(pickedRow.name, version === pickedRow.current ? undefined : version);
        }}
        onClose={closePicker}
      />
    );
  }

  const actionsFor = (row: PackageRow): ToolbarAction[] => {
    const picked = chosen[row.name];
    return [
      //? A version chosen in the picker is what the row is now for: its switch leads
      ...(picked
        ? [
            {
              hotkey: 's',
              label: `Switch ${row.current} → ${picked}`,
              onPress: () => setVersion(row, picked),
              tone: 'primary' as const,
            },
          ]
        : []),
      ...(row.update !== 'none' && row.latest
        ? [
            {
              hotkey: 'u',
              label: `Update → ${row.latest}`,
              onPress: () => update(row),
              tone: picked ? ('normal' as const) : ('primary' as const),
            },
          ]
        : []),
      ...(row.prerelease
        ? [{ hotkey: 'U', label: `→ ${row.prerelease}`, onPress: () => updatePrerelease(row) }]
        : []),
      ...(row.local
        ? []
        : [
            {
              hotkey: 'v',
              label: picked ? `Version: ${picked}…` : 'Versions…',
              onPress: () => openPicker(row),
            },
          ]),
      ...(picked
        ? [{ hotkey: 'r', label: `Reset (${row.current})`, onPress: () => choose(row.name, undefined) }]
        : []),
      { hotkey: 'n', label: row.note ? 'Edit note' : 'Note', onPress: () => editNote(row) },
      ...(row.local
        ? []
        : [
            {
              hotkey: 'w',
              label: 'npm page',
              onPress: () => openUrl(`https://www.npmjs.com/package/${row.name}`),
            },
          ]),
      { hotkey: 'x', label: 'Remove', onPress: () => remove(row), tone: 'danger' as const },
    ];
  };

  const outdatedCount = rows.filter(isOutdated).length;
  const unsupportedCount = rows.filter(
    (row) => isUnsupported(support[row.name]) || row.deprecated,
  ).length;
  const hints: Hint[] = [
    {
      key: 'o',
      label: onlyOutdated ? 'show all' : `outdated (${outdatedCount})`,
      onPress: toggleOutdated,
    },
    {
      key: 'e',
      label: `[${supportMode ? 'x' : ' '}] EOL/stale mode (${unsupportedCount})`,
      onPress: toggleSupportMode,
    },
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
    { key: 'c', label: 'check now', onPress: checkNow },
    { key: 'A', label: 'update minor/patch', onPress: updateSafe },
  ];

  const lastChecked = Object.values(infos ?? {})
    .map((info) => info.fetchedAt)
    .filter(Boolean)
    .sort()[0];
  const age = lastChecked ? Math.round((Date.now() - lastChecked) / 60000) : undefined;
  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {progress
        ? `Checking the registry… ${progress.done}/${progress.total}`
        : !manifest
          ? 'Reading package.json…'
          : `${rows.length} packages · ${outdatedCount} with updates · ${rows.filter((row) => row.deprecated).length} deprecated · ${
              rows.filter((row) => isUnsupported(support[row.name])).length
            } EOL/stale${
              age !== undefined ? ` · checked ${age < 1 ? 'just now' : `${age}m ago`}` : ''
            }${onlyOutdated ? ' · outdated only' : ''}${supportMode ? ' · EOL/stale mode' : ''}${
              filter ? ` · "${filter}"` : ''
            }`}
    </Text>
  );

  if (manifest && !manifest.exists) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={colors.warn}>{`No package.json in ${dir}`}</Text>
        <Text color={colors.muted} wrap="wrap">
          pkgi lists the packages of the folder it is started in. cd into a project (or a workspace
          member) and run it there — the Compare tab can still look at other folders from here.
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        //? Remounted when the rows change (a filter, the outdated toggle), restoring the cursor by
        //? package name instead of leaving it on whatever slid into its old position
        key={`${filter}|${onlyOutdated}|${supportMode}|${visible.length}|${suggestions.length}`}
        title={`Packages (${visible.length}) · ${unicodeIcons ? '↑' : 'U'} update · ${unicodeIcons ? '⇡' : 'P'} pre · = latest · ? unknown${suggestions.length ? ' · + add' : ''}`}
        items={items}
        emptyText={
          isReading
            ? 'Reading package.json…'
            : (manifest?.error ??
              (onlyOutdated
                ? 'Everything is up to date.'
                : filter
                  ? searching && isSearching
                    ? 'Nothing installed matches — searching the registry…'
                    : 'Nothing matches, here or on the registry.'
                  : 'No dependencies.'))
        }
        detailTitle={
          current
            ? `${current.name} · ${current.type}`
            : currentResult
              ? `${currentResult.name} · on the registry`
              : 'Package'
        }
        reservedChrome={['viewHeader']}
        activateLabel={
          currentResult
            ? `add as ${settings.installAs}`
            : current && chosen[current.name]
              ? `switch to ${chosen[current.name]}`
              : 'update'
        }
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) =>
          item.value?.kind === 'registry' ? add(item.value.result.name, chosen[item.value.result.name]) : item.value?.row && chosen[item.value.row.name]
            ? setVersion(item.value.row, chosen[item.value.row.name] as string)
            : update(item.value?.row)
        }
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.packages = item?.id;
        }}
        detailFocusable
        renderDetail={(item, _index, focus) => {
          const entry = item?.value;
          if (!entry) return null;
          if (entry.kind === 'registry') {
            const { result } = entry;
            return (
              <Box flexDirection="column">
                <Toolbar
                  actions={addActions(result, chosen[result.name], {
                    add,
                    choose: () => setAddPicker(result.name),
                    reset: () => choose(result.name, undefined),
                  })}
                  isFocused={focus.isFocused}
                  onExit={focus.blur}
                />
                <RegistryPackageDetail
                  name={result.name}
                  dir={dir}
                  registry={settings.registry}
                  cacheHours={settings.cacheHours}
                  showUnstable={settings.showUnstable}
                />
              </Box>
            );
          }
          const { row } = entry;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} isFocused={focus.isFocused} onExit={focus.blur} />
              <PackageDetail row={row} support={support[row.name]} registry={settings.registry} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default PackagesView;

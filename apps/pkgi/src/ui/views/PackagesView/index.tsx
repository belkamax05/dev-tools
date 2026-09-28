import { Text, useInput } from 'ink';
import { type ReactNode, useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl from '@/dev-tools/utils/system/openUrl';

import type { DependencyType } from '../../../config/settings';
import { ENDOFLIFE_PRODUCTS, getSupport, type SupportInfo } from '../../../core/eol';
import { readManifest, removeCommand, setVersionCommand, shellQuote } from '../../../core/manifest';
import { buildRows, fetchInfos, isOutdated, type PackageRow } from '../../../core/packages';
import { getVersionDetails, type VersionDetails } from '../../../core/registry';
import { majorDistance } from '../../../core/semver';
import type { ViewProps } from '../../types';
import VersionPicker from '../../VersionPicker';

export const TYPE_LABELS: Record<DependencyType, string> = {
  dependencies: 'Dependencies',
  devDependencies: 'Dev dependencies',
  peerDependencies: 'Peer dependencies',
  optionalDependencies: 'Optional dependencies',
};

type Colors = ReturnType<typeof useColors>;

/** The colour an update is drawn in: the web page's chips — major red, minor amber, patch green. */
export const updateColor = (row: PackageRow, colors: Colors, support?: SupportInfo) => {
  if (row.deprecated || support?.status === 'eol') return colors.error;
  if (row.update === 'major') return colors.error;
  if (row.update === 'minor') return colors.warn;
  if (row.update === 'patch') return colors.ok;
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
  if (support?.status === 'eol') parts.push('⚠ EOL');
  else if (support?.status === 'ending') parts.push('EOL soon');
  if (row.mismatch) parts.push('≠ declared');
  if (row.note) parts.push('✎');
  return parts.join(' ');
};

const Field = ({ label, children }: { label: string; children: ReactNode }) => {
  const colors = useColors();
  return (
    <Box flexDirection="row">
      <Box width={12} flexShrink={0}>
        <Text color={colors.muted}>{label}</Text>
      </Box>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
};

const PackageDetail = ({
  row,
  support,
  registry,
}: {
  row: PackageRow;
  support?: SupportInfo;
  registry: string;
}) => {
  const colors = useColors();
  const { data: details } = useLoader(
    (): VersionDetails | Promise<VersionDetails> =>
      row.local ? {} : getVersionDetails(row.name, row.latest ?? row.current, registry),
    [row.name, row.latest, row.current, registry],
  );
  return (
    <Box flexDirection="column">
      <Text bold color={colors.heading} wrap="truncate">
        {row.name}
      </Text>
      {details?.description && (
        <Text color={colors.muted} wrap="wrap">
          {details.description}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Field label="Declared">
          <Text color={colors.text} wrap="truncate">{`${row.range}  in ${row.type}`}</Text>
        </Field>
        <Field label="Installed">
          <Text
            color={row.installed ? (row.mismatch ? colors.warn : colors.text) : colors.warn}
            wrap="truncate"
          >
            {row.installed
              ? `${row.installed}${row.mismatch ? ' — not what package.json declares; reinstall' : ''}`
              : 'not in node_modules — run an install'}
          </Text>
        </Field>
        {!row.local && (
          <Field label="Latest">
            <Text color={updateColor(row, colors)} wrap="truncate">
              {row.info?.error === 'not-found'
                ? 'not on the registry (private, or a local package)'
                : row.latest
                  ? `${row.latest}${row.update !== 'none' ? `  · ${row.update} update` : '  · up to date'}`
                  : (row.info?.error ?? '…')}
            </Text>
          </Field>
        )}
        {row.prerelease && (
          <Field label="Prerelease">
            <Text
              color={colors.highlight}
              wrap="truncate"
            >{`${row.prerelease}  (${row.prereleaseTag})`}</Text>
          </Field>
        )}
        {support && (
          <Field label="Support">
            <Text
              color={
                support.status === 'eol'
                  ? colors.error
                  : support.status === 'ending'
                    ? colors.warn
                    : support.status === 'supported'
                      ? colors.ok
                      : colors.muted
              }
              wrap="truncate"
            >
              {`${support.summary}${support.lts ? ' (LTS)' : ''} · ${support.product}`}
            </Text>
          </Field>
        )}
        {details?.license && (
          <Field label="License">
            <Text color={colors.muted}>{details.license}</Text>
          </Field>
        )}
        {(details?.homepage || details?.repository) && (
          <Field label="Home">
            <Text color={colors.muted} wrap="truncate">
              {details.homepage ?? details.repository}
            </Text>
          </Field>
        )}
      </Box>
      {row.deprecated && (
        <Box marginTop={1}>
          <Text color={colors.error} wrap="wrap">{`Deprecated: ${row.deprecated}`}</Text>
        </Box>
      )}
      {row.note && (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.accent}>Note</Text>
          <Text color={colors.text} wrap="wrap">
            {row.note}
          </Text>
        </Box>
      )}
    </Box>
  );
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
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.packages);
  const [picker, setPicker] = useState(session.picker?.mode === 'set' ? session.picker : undefined);
  const [check, setCheck] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | undefined>();
  const force = useRef(false);

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
      onProgress: (done, total) => setProgress({ done, total }),
    });
    setProgress(undefined);
    return result;
  }, [registryNames, settings.registry, settings.cacheHours, check]);

  const rows = manifest ? buildRows(manifest, infos ?? {}, context.state.notes, settings) : [];
  const supportKey = rows
    .filter((row) => ENDOFLIFE_PRODUCTS[row.name])
    .map((row) => `${row.name}@${row.current}`)
    .join(',');
  const { data: support = {} } = useLoader(async () => {
    const entries = await Promise.all(
      rows
        .filter((row) => ENDOFLIFE_PRODUCTS[row.name] && row.current)
        .map(
          async (row) =>
            [row.name, await getSupport(row.name, row.current, force.current)] as const,
        ),
    );
    force.current = false;
    return Object.fromEntries(entries.filter(([, info]) => info)) as Record<string, SupportInfo>;
  }, [supportKey, check]);

  const visible = rows.filter(
    (row) =>
      (!onlyOutdated || isOutdated(row) || row.deprecated) &&
      (!filter ||
        row.name.toLowerCase().includes(filter.toLowerCase()) ||
        row.note?.toLowerCase().includes(filter.toLowerCase())),
  );
  const current = visible.find((row) => row.name === currentId);

  const items: PickItem<PackageRow>[] = settings.dependencyTypes.flatMap((type) => {
    const group = visible.filter((row) => row.type === type);
    if (!group.length) return [];
    return [
      { id: `header-${type}`, label: `${TYPE_LABELS[type]} (${group.length})`, isHeader: true },
      ...group.map((row) => ({
        id: row.name,
        label: row.name,
        hint: rowHint(row, support[row.name], isChecking),
        hintColor: updateColor(row, colors, support[row.name]),
        value: row,
      })),
    ];
  });

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

  const checkNow = () => {
    force.current = true;
    setCheck((count) => count + 1);
    notify('Asking the registry for every package…');
  };

  const toggleOutdated = () => {
    setOnlyOutdated((was) => {
      session.onlyOutdated = !was;
      return !was;
    });
  };

  const askFilter = () =>
    prompt.ask(
      'Filter (name or note):',
      (value) => {
        setFilter(value.trim());
        session.filter = value.trim();
      },
      { initial: filter },
    );

  useInput(
    (input, key) => {
      if (input === 'u') update(current);
      else if (input === 'U') updatePrerelease(current);
      else if (input === 'A') updateSafe();
      else if (input === 'v') openPicker(current);
      else if (input === 'x') remove(current);
      else if (input === 'n') editNote(current);
      else if (input === 'w' && current) openUrl(`https://www.npmjs.com/package/${current.name}`);
      else if (input === 'o') toggleOutdated();
      else if (input === 'c') checkNow();
      else if (input === '/') askFilter();
      else if (key.escape && filter) {
        setFilter('');
        session.filter = '';
      }
    },
    { isActive: !prompt.isOpen && !picker },
  );

  const pickedRow = picker && rows.find((row) => row.name === picker.name);
  if (picker && pickedRow) {
    return (
      <VersionPicker
        name={pickedRow.name}
        current={pickedRow.current}
        registry={settings.registry}
        cacheHours={settings.cacheHours}
        showUnstable={settings.showUnstable}
        verb="switch to"
        onPick={(version) => {
          closePicker();
          setVersion(pickedRow, version);
        }}
        onClose={closePicker}
      />
    );
  }

  const actionsFor = (row: PackageRow): ToolbarAction[] => [
    ...(row.update !== 'none' && row.latest
      ? [
          {
            hotkey: 'u',
            label: `Update → ${row.latest}`,
            onPress: () => update(row),
            tone: 'primary' as const,
          },
        ]
      : []),
    ...(row.prerelease
      ? [{ hotkey: 'U', label: `→ ${row.prerelease}`, onPress: () => updatePrerelease(row) }]
      : []),
    ...(row.local ? [] : [{ hotkey: 'v', label: 'Versions…', onPress: () => openPicker(row) }]),
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

  const outdatedCount = rows.filter(isOutdated).length;
  const hints: Hint[] = [
    {
      key: 'o',
      label: onlyOutdated ? 'show all' : `outdated (${outdatedCount})`,
      onPress: toggleOutdated,
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
          : `${rows.length} packages · ${outdatedCount} with updates · ${rows.filter((row) => row.deprecated).length} deprecated${
              age !== undefined ? ` · checked ${age < 1 ? 'just now' : `${age}m ago`}` : ''
            }${onlyOutdated ? ' · outdated only' : ''}${filter ? ` · "${filter}"` : ''}`}
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
        key={`${filter}|${onlyOutdated}|${visible.length}`}
        title={`Packages (${visible.length})`}
        items={items}
        emptyText={
          isReading
            ? 'Reading package.json…'
            : (manifest?.error ??
              (onlyOutdated
                ? 'Everything is up to date.'
                : filter
                  ? 'Nothing matches.'
                  : 'No dependencies.'))
        }
        detailTitle={current ? `${current.name} · ${current.type}` : 'Package'}
        reservedChrome={['viewHeader']}
        activateLabel="update"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => update(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.packages = item?.id;
        }}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} />
              <PackageDetail row={row} support={support[row.name]} registry={settings.registry} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default PackagesView;

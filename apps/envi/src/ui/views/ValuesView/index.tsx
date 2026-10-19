import { Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import { isSecretKey } from '../../../config/settings';
import {
  type Location,
  locationLabel,
  locationOf,
  locationsOf,
  readRaw,
  removeAt,
  setTargetLocation,
  setTextAt,
  setValueAt,
  withLocation,
} from '../../../core/locations';
import { isOpRef, OP_LABEL } from '../../../core/onePassword';
import { quoteValue } from '../../../core/parse';
import type { ResolvedVar, VarSource, VarStatus } from '../../../core/resolve';
import { matchesSearch } from '../../../core/search';
import { launchEnv, readApplied } from '../../../core/shell';
import type { ViewProps } from '../../App';
import useLocationPicker from '../../useLocationPicker';
import useSearch from '../../useSearch';
import useWrite from '../../useWrite';
import ValueBlock, { isPathList, preview } from '../../ValueBlock';

type Row =
  | { kind: 'missing'; key: string; from: string }
  | { kind: 'var'; entry: ResolvedVar }
  | {
      kind: 'shell';
      key: string;
      value: string;
      /** The hook exported it, rather than the shell's own rc or a parent process. */
      fromEnvi: boolean;
    };

export const STATUS_TEXT: Record<VarStatus, string> = {
  new: '+ new',
  changed: '~ replaces shell',
  same: '= same as shell',
  kept: '⊘ shell wins',
};

const STATUS_GLYPH: Record<VarStatus, string> = {
  new: '+',
  changed: '~',
  same: '=',
  kept: '⊘',
};

export const where = (source: VarSource) =>
  source.line ? `${source.label}:${source.line}` : source.label;

/** The id a variable's row has in the Locations tab: its winning layer, then its name. */
export const locationRowId = (layerId: string, key: string) => `${layerId}::${key}`;

/**
 * Every value here, in one list: what envi provides first — your vars, machine vars, the env
 * files and env.config.ts, each with the layer that won and how it compares with the shell; the
 * required ones nothing sets ahead of them — then, as a second list, what the shell exports that
 * envi leaves alone.
 *
 * This tab is about a *value*: copy it, change it where it comes from, set it somewhere else
 * ([s] — the setTarget setting's place on Enter), or [l] look at where it is kept in Locations.
 */
export const ValuesView = ({
  resolution,
  isLoading,
  config,
  cwd,
  session,
  reveal,
  secrets,
  notify,
  reload,
  onConfigChange,
  onCaptureInput,
  onEdit,
  onJump,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const picker = useLocationPicker(onCaptureInput);
  const write = useWrite({ onConfigChange, notify, reload });
  const { search, open, clear, hints: searchHints } = useSearch(session, 'values', prompt);
  const [currentId, setCurrentId] = useState(session.selected.values);
  const busy = prompt.isOpen || picker.isOpen;

  const shellEnv = useMemo(() => {
    const env = launchEnv();
    const applied = readApplied(env);
    return Object.entries(env)
      .map(([key, value]) => ({ key, value, fromEnvi: key in applied }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, []);

  const isSecret = (key: string) => isSecretKey(key, config.maskPatterns);
  const rowPreview = (key: string, value: string) =>
    preview(secrets.shown(value, reveal), isSecret(key), reveal);

  const enviKeys = new Set((resolution?.vars ?? []).map((entry) => entry.key));
  const vars = (resolution?.vars ?? []).filter((entry) =>
    matchesSearch(entry.key, entry.value, search),
  );
  const missing = (resolution?.missing ?? []).filter((entry) =>
    matchesSearch(entry.key, '', search),
  );
  const shellOnly = shellEnv.filter((entry) => !enviKeys.has(entry.key)).length;
  //? A name envi sets is in the first list already, with the shell's value beside its own
  //? Held back until the layers are read: drawn alone first, the cursor would settle on a shell
  //? row and stay there once envi's own values arrive above it
  const shell = resolution
    ? shellEnv.filter(
        (entry) => !enviKeys.has(entry.key) && matchesSearch(entry.key, entry.value, search),
      )
    : [];

  const statusColor = (status: VarStatus) =>
    status === 'new'
      ? colors.ok
      : status === 'changed'
        ? colors.warn
        : status === 'kept'
          ? colors.muted
          : colors.text;

  const items: PickItem<Row>[] = [
    ...(missing.length
      ? [
          { id: 'header-missing', label: `Missing — required, nothing sets them (${missing.length})`, isHeader: true },
          ...missing.map((entry) => ({
            id: `missing:${entry.key}`,
            label: entry.key,
            prefix: { text: '✗', color: colors.error },
            hint: `required by ${entry.from}`,
            hintColor: colors.error,
            value: { kind: 'missing' as const, ...entry },
          })),
        ]
      : []),
    ...(resolution && (vars.length || !shell.length)
      ? [{ id: 'header-envi', label: `From envi — your vars, files, env.config.ts (${vars.length})`, isHeader: true }]
      : []),
    ...vars.map((entry) => ({
      id: entry.key,
      label: entry.key,
      prefix: { text: STATUS_GLYPH[entry.status], color: statusColor(entry.status) },
      hint:
        entry.status === 'kept'
          ? `${STATUS_TEXT.kept} · ${entry.source.label}`
          : `${rowPreview(entry.key, entry.value).slice(0, 60)}  · ${entry.source.label}`,
      hintColor: entry.status === 'kept' ? colors.muted : undefined,
      value: { kind: 'var' as const, entry },
    })),
    ...(shell.length
      ? [{ id: 'header-shell', label: `From the shell — envi leaves these alone (${shell.length})`, isHeader: true }]
      : []),
    ...shell.map((entry) => ({
      id: `shell:${entry.key}`,
      label: entry.key,
      prefix: { text: entry.fromEnvi ? '◆' : ' ', color: colors.accent },
      hint: rowPreview(entry.key, entry.value),
      hintColor: isSecret(entry.key) && !reveal ? colors.warn : colors.muted,
      value: { kind: 'shell' as const, ...entry },
    })),
  ];
  const current =
    items.find((item) => item.id === currentId && item.value)?.value ??
    items.find((item) => item.value)?.value;

  const locations = locationsOf(resolution);
  const preferred = setTargetLocation(config.setTarget, cwd, locations);
  const targets = withLocation(locations, preferred);

  const layerOf = (source: VarSource) =>
    resolution?.layers.find((layer) => layer.id === source.layerId);
  const sourceLocation = (entry: ResolvedVar): Location | undefined => {
    const layer = layerOf(entry.source);
    return layer && locationOf(layer);
  };

  const keyOf = (row: Row | undefined) => (row?.kind === 'var' ? row.entry.key : row?.key);
  const valueOf = (row: Row | undefined) =>
    row?.kind === 'var' ? row.entry.value : row?.kind === 'shell' ? row.value : '';

  /** Ask for a value (as written — `$OTHER` expands) and set it at `location`. */
  const askValue = (location: Location, key: string, initial: string, quote: '' | '"' | "'" | '`' = '') =>
    prompt.ask(
      `${key} in ${locationLabel(location)} =`,
      (text) => write(setTextAt(location, key, text, config, quote), `${key} set in ${locationLabel(location)}`),
      { initial, secret: isSecret(key) && !reveal && !isOpRef(initial) },
    );

  /** Change the value where it comes from — an env.config.ts is opened instead. */
  const editAtSource = (entry: ResolvedVar) => {
    const location = sourceLocation(entry);
    if (!location) {
      if (entry.source.path) onEdit(entry.source.path);
      return;
    }
    readRaw(location, entry.key, config)
      .then((raw) => askValue(location, entry.key, raw?.text ?? entry.source.value, raw?.quote))
      .catch((error: Error) => notify(error.message, 'error'));
  };

  /** Pick a place, then the value to set there — a value from the shell is kept as it is. */
  const setAt = (row: Row | undefined) => {
    const key = keyOf(row);
    if (!row || !key) return;
    const verb = row.kind === 'var' ? 'Set' : row.kind === 'shell' ? 'Keep' : 'Set';
    picker.open(
      `${verb} ${key} in:`,
      targets,
      (location) => {
        if (row.kind === 'shell')
          write(setValueAt(location, key, row.value, config), `${key} kept in ${locationLabel(location)}`);
        else askValue(location, key, valueOf(row));
      },
      preferred,
    );
  };

  /** Delete the winning line — the next layer down (or the shell) takes over. */
  const removeSource = (entry: ResolvedVar) => {
    const location = sourceLocation(entry);
    if (!location) {
      if (entry.source.path) onEdit(entry.source.path);
      return;
    }
    const next = entry.shadowed.at(-1);
    const fallback = next
      ? `${where(next)} takes over`
      : entry.shell !== undefined
        ? 'the shell’s value stays'
        : 'it will be unset';
    prompt.confirm(`Remove ${entry.key} from ${where(entry.source)}? (${fallback})`, () =>
      write(removeAt(location, entry.key, config), `${entry.key} removed from ${entry.source.label}`),
    );
  };

  const copy = (row: Row | undefined, withKey = false) => {
    const key = keyOf(row);
    if (!row || !key || row.kind === 'missing') return;
    const value = valueOf(row);
    copyToClipboard(withKey ? `${key}=${quoteValue(value)}` : value);
    notify(`Copied ${withKey ? `${key}=…` : `the value of ${key}`}`, 'ok');
  };

  /** The secret itself — a reference read from 1Password first — onto the clipboard. */
  const copySecret = (row: Row | undefined) => {
    const key = keyOf(row);
    if (!row || !key || row.kind === 'missing') return;
    const value = valueOf(row);
    secrets
      .secretOf(value)
      .then((secret) => {
        copyToClipboard(secret);
        notify(`Copied ${key}'s secret${isOpRef(value) ? ` (read from ${OP_LABEL})` : ''}`, 'ok');
      })
      .catch((error: Error) => notify(error.message, 'error'));
  };

  const showInLocations = (entry: ResolvedVar) =>
    onJump('locations', locationRowId(entry.source.layerId, entry.key));

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'var') editAtSource(row.entry);
    else if (row.kind === 'missing') setAt(row);
    else copy(row);
  };

  useInput(
    (input, key) => {
      if (input === '/') open();
      else if (key.escape && search) clear();
      else if (!current) return;
      else if (input === 'c') copy(current);
      else if (input === 'y') copy(current, true);
      else if (input === 'C') copySecret(current);
      else if (input === 's') setAt(current);
      else if (current.kind !== 'var') return;
      else if (input === 'e') editAtSource(current.entry);
      else if (input === 'l') showInLocations(current.entry);
      else if (input === 'x') removeSource(current.entry);
      else if (input === 'o' && current.entry.source.path) onEdit(current.entry.source.path);
    },
    { isActive: !busy },
  );

  const actionsFor = (row: Row): ToolbarAction[] => {
    if (row.kind === 'missing') {
      return [{ hotkey: 's', label: 'Set in…', onPress: () => setAt(row), tone: 'primary' }];
    }
    const value = valueOf(row);
    const copies: ToolbarAction[] = [
      { hotkey: 'c', label: isOpRef(value) ? 'Copy reference' : 'Copy', onPress: () => copy(row) },
      ...(isOpRef(value)
        ? [{ hotkey: 'C', label: 'Copy secret', onPress: () => copySecret(row) }]
        : []),
      { hotkey: 'y', label: 'Copy KEY=value', onPress: () => copy(row, true) },
    ];
    if (row.kind === 'shell') {
      return [
        { ...(copies[0] as ToolbarAction), tone: 'primary' },
        ...copies.slice(1),
        { hotkey: 's', label: 'Keep in…', onPress: () => setAt(row) },
      ];
    }
    const { entry } = row;
    const writable = Boolean(sourceLocation(entry));
    return [
      {
        hotkey: 'e',
        label: writable ? `Edit in ${entry.source.label}` : 'Edit config',
        onPress: () => editAtSource(entry),
        tone: 'primary',
      },
      //? KEY=value and the editor stay keys ([y], [o] in the hints) — a short stack scans faster
      ...copies.filter((action) => action.hotkey !== 'y'),
      { hotkey: 's', label: 'Set in…', onPress: () => setAt(row) },
      { hotkey: 'l', label: 'Show in Locations', onPress: () => showInLocations(entry) },
      ...(writable
        ? [{ hotkey: 'x', label: 'Remove', onPress: () => removeSource(entry), tone: 'danger' as const }]
        : []),
    ];
  };

  const renderVar = (entry: ResolvedVar) => {
    const secret = isSecret(entry.key);
    const show = (value: string) => preview(secrets.shown(value, reveal), secret, reveal);
    return (
      <Box flexDirection="column">
        <Text color={statusColor(entry.status)} bold>
          {`${STATUS_TEXT[entry.status]} · from ${where(entry.source)}`}
        </Text>
        <Box marginTop={1}>
          <ValueBlock
            name={entry.key}
            value={entry.value}
            secret={secret}
            reveal={reveal}
            {...secrets.blockProps(entry.value)}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.heading}>Layers, first to last</Text>
          {entry.shadowed.map((source) => (
            <Text key={`${source.layerId}:${source.line ?? ''}`} color={colors.muted} wrap="truncate">
              {`  ${where(source)}  ${show(source.value)}`}
            </Text>
          ))}
          <Text color={entry.status === 'kept' ? colors.muted : colors.accent} wrap="truncate">
            {`→ ${where(entry.source)}  ${show(entry.source.value)}`}
          </Text>
          {entry.shell !== undefined && (
            <Text color={entry.status === 'kept' ? colors.accent : colors.muted} wrap="truncate">
              {`${entry.status === 'kept' ? '→' : ' '} shell  ${show(entry.shell)}${entry.status === 'kept' ? '  (override is off)' : ''}`}
            </Text>
          )}
        </Box>
      </Box>
    );
  };

  const renderShell = (row: Extract<Row, { kind: 'shell' }>) => (
    <Box flexDirection="column">
      <Text color={colors.muted} wrap="truncate">
        {[
          'from the shell',
          `${row.value.length} chars`,
          isPathList(row.key, row.value) ? `${row.value.split(':').length} entries` : '',
          isSecret(row.key) ? 'secret' : '',
          row.fromEnvi ? '◆ exported by the envi hook' : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Box marginTop={1}>
        <ValueBlock
          name={row.key}
          value={row.value}
          secret={isSecret(row.key)}
          reveal={reveal}
          {...secrets.blockProps(row.value)}
        />
      </Box>
    </Box>
  );

  const header = picker.line ?? prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {resolution
        ? [
            `${resolution.vars.length} from envi`,
            `${shellOnly} from the shell`,
            resolution.missing.length ? `${resolution.missing.length} required missing` : '',
            search ? `${vars.length + shell.length + missing.length} match "${search}"` : '',
            '+ new · ~ replaces shell · = same · ⊘ shell wins · ◆ set by the hook',
          ]
            .filter(Boolean)
            .join(' · ')
        : 'Reading the layers…'}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        title={`Values (${vars.length + shell.length})`}
        items={items}
        emptyText={
          isLoading && !resolution
            ? 'Reading the layers…'
            : search
              ? 'No name or value matches — Esc clears the search.'
              : 'No variables.'
        }
        detailTitle={keyOf(current) ?? 'Variable'}
        reservedChrome={['viewHeader']}
        activateLabel={current?.kind === 'shell' ? 'copy' : current?.kind === 'missing' ? 'set' : 'edit'}
        //? A missing row's Enter (pick a place to set it) runs on a click too; a value only selects
        activateOnClick={(item) => item.value?.kind === 'missing'}
        initialSelectedId={currentId}
        isInputActive={!busy}
        hints={[
          ...searchHints,
          ...(current?.kind === 'var'
            ? [
                { key: 'y', label: 'copy KEY=value', onPress: () => copy(current, true) },
                ...(current.entry.source.path
                  ? [{ key: 'o', label: 'open file', onPress: () => onEdit(current.entry.source.path ?? '') }]
                  : []),
              ]
            : []),
        ]}
        onActivate={(item) => activate(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.values = item?.id;
        }}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} />
              {row.kind === 'missing' ? (
                <Text color={colors.error} wrap="wrap">
                  {`Required by ${row.from}, and nothing sets it — not the shell, not a layer. [s] sets it in the place you pick.`}
                </Text>
              ) : row.kind === 'var' ? (
                renderVar(row.entry)
              ) : (
                renderShell(row)
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default ValuesView;

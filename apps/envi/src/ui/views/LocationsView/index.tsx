import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import {
  PROJECT_CONFIG_NAMES,
  PROJECT_CONFIG_TEMPLATE,
  type ProjectConfig,
} from '../../../config/project';
import { configStore, DEFAULT_FILES, isSecretKey, stateStore } from '../../../config/settings';
import {
  type Location,
  locationId,
  locationLabel,
  locationsOf,
  readRaw,
  removeAt,
  renameAt,
  sameLocation,
  setTargetLocation,
  setTextAt,
  transferVar,
} from '../../../core/locations';
import { isOpRef, OP_LABEL, OP_PREFIX } from '../../../core/onePassword';
import { isValidKey, parseAssignment, quoteValue } from '../../../core/parse';
import { disableFile, enableFile, type Layer } from '../../../core/resolve';
import { matchesSearch } from '../../../core/search';
import type { ViewProps } from '../../App';
import useLocationPicker from '../../useLocationPicker';
import useSearch from '../../useSearch';
import useWrite from '../../useWrite';
import ValueBlock, { preview } from '../../ValueBlock';
import { locationRowId, STATUS_TEXT, where } from '../ValuesView';

/** A place values are kept, as the tree draws it: a row of its own, its values under it. */
interface Place {
  /** The layer id — `user`, `machine`, `file:…`, `project:…` — and the fold key. */
  id: string;
  /** Where envi can write; unset for an env.config.ts, which is code and is opened instead. */
  location?: Location;
  layer?: Layer;
  project?: ProjectConfig;
}

type Row =
  | { kind: 'place'; place: Place }
  | { kind: 'var'; place: Place; key: string; value: string; line?: number }
  | { kind: 'addFile' }
  | { kind: 'defaults' }
  | { kind: 'init' };

const STATE_GLYPH: Record<Layer['status'], string> = {
  loaded: '●',
  missing: '·',
  disabled: '○',
  error: '✗',
};

const tilde = (path: string) => path.replace(homedir(), '~');

/**
 * Every place envi's values are kept, in the order it applies them, each with its values under
 * it: your vars and machine vars (every folder), the env files read here, and each env.config.ts.
 *
 * This tab is about *where*: add a value to a place, edit or rename it there, move or copy it to
 * another place ([m] / [M]) — as written, so a `${HOST}` stays a reference — and manage the
 * places themselves: switch a file off, reorder your list, add one, create env.config.ts. [l]
 * shows a value in the Values tab, with every layer that sets it.
 */
export const LocationsView = ({
  resolution,
  isLoading,
  config,
  cwd,
  session,
  reveal,
  secrets,
  onToggleReveal,
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
  const { search, open, clear, hints: searchHints } = useSearch(session, 'locations', prompt);
  const [currentId, setCurrentIdState] = useState(session.selected.locations);
  const [collapsed, setCollapsedState] = useState<ReadonlySet<string>>(new Set(session.collapsed));
  const busy = prompt.isOpen || picker.isOpen;

  const select = (id: string | undefined) => {
    setCurrentIdState(id);
    session.selected.locations = id;
  };
  const setCollapsed = (next: ReadonlySet<string>) => {
    setCollapsedState(next);
    session.collapsed = [...next];
  };

  const layers = resolution?.layers ?? [];
  const layerById = (id: string) => layers.find((layer) => layer.id === id);
  const files = layers.filter((layer) => layer.kind === 'file');
  const projects = resolution?.projects ?? [];
  const hasLocalConfig = PROJECT_CONFIG_NAMES.some((name) => existsSync(join(cwd, name)));
  const missingDefaults = DEFAULT_FILES.filter((name) => !config.files.includes(name));
  const locations = locationsOf(resolution);
  const isSecret = (key: string) => isSecretKey(key, config.maskPatterns);

  const stores: Place[] = [
    { id: 'user', location: { kind: 'config' }, layer: layerById('user') },
    { id: 'machine', location: { kind: 'state' }, layer: layerById('machine') },
  ];
  const filePlaces: Place[] = files.map((layer) => ({
    id: layer.id,
    layer,
    location: locations.find((location) => locationId(location) === layer.id),
  }));
  const projectPlaces: Place[] = projects.map((project) => ({
    id: `project:${project.path}`,
    project,
    layer: layerById(`project:${project.path}`),
  }));
  const allPlaces = [...stores, ...filePlaces, ...projectPlaces];

  const placeName = (place: Place) =>
    place.location
      ? locationLabel(place.location)
      : place.project
        ? place.project.path.replace(`${resolution?.root ?? ''}/`, '')
        : place.id;

  const placePath = (place: Place) =>
    place.location?.kind === 'config'
      ? configStore.path
      : place.location?.kind === 'state'
        ? stateStore.path
        : (place.layer?.path ?? place.project?.path);

  const entriesOf = (place: Place) =>
    (place.layer?.entries ?? []).filter((entry) => matchesSearch(entry.key, entry.value, search));

  const winnerOf = (key: string) => resolution?.vars.find((entry) => entry.key === key);
  /** This line is the one envi ends up with (or would, but for the shell). */
  const wins = (place: Place, key: string, line?: number) => {
    const winner = winnerOf(key);
    return winner?.source.layerId === place.id && winner.source.line === line;
  };

  const placeHint = (place: Place) => {
    const count = place.layer?.entries.length ?? 0;
    if (place.project) {
      return place.project.error
        ? 'error'
        : `${Object.keys(place.project.vars).length} vars · ${place.project.files.length} files`;
    }
    const layer = place.layer;
    const vars = `${count} var${count === 1 ? '' : 's'}`;
    if (place.location?.kind !== 'file' || !layer) return vars;
    return layer.status === 'loaded'
      ? `${vars}${layer.errors.length ? ` · ${layer.errors.length} bad lines` : ''}${layer.listedBy === 'config' ? '' : ' · ⚙'}`
      : layer.status === 'disabled'
        ? layer.disabledBy === 'config'
          ? 'off'
          : 'off in env.config.ts'
        : layer.status === 'missing'
          ? 'not created'
          : 'unreadable';
  };

  const toggleFold = (place: Place) => {
    const next = new Set(collapsed);
    if (next.has(place.id)) next.delete(place.id);
    else next.add(place.id);
    setCollapsed(next);
  };

  const placeItems = (place: Place): PickItem<Row>[] => {
    const entries = entriesOf(place);
    //? A search opens every place: a match folded away would look like no match
    const folded = collapsed.has(place.id) && !search;
    const glyph = place.project
      ? place.project.error
        ? '✗'
        : '⚙'
      : place.location?.kind === 'file' && place.layer
        ? STATE_GLYPH[place.layer.status]
        : '●';
    return [
      {
        id: place.id,
        label: placeName(place),
        prefix: {
          text: glyph,
          color:
            place.layer?.status === 'error' || place.project?.error
              ? colors.error
              : place.layer?.status === 'loaded' && place.layer.entries.length
                ? colors.ok
                : colors.muted,
        },
        controls: [
          {
            id: 'fold',
            glyph: folded ? '▸' : '▾',
            color: colors.muted,
            onPress: () => toggleFold(place),
          },
        ],
        hint: placeHint(place),
        hintColor: place.layer?.status === 'error' ? colors.error : undefined,
        value: { kind: 'place' as const, place },
      },
      ...(folded
        ? []
        : entries.map((entry) => {
            const won = wins(place, entry.key, entry.line);
            return {
              id: locationRowId(place.id, entry.key),
              label: entry.key,
              indent: 2,
              prefix: { text: won ? '●' : '○', color: won ? colors.accent : colors.muted },
              hint: preview(secrets.shown(entry.value, reveal), isSecret(entry.key), reveal),
              hintColor: won ? undefined : colors.muted,
              value: {
                kind: 'var' as const,
                place,
                key: entry.key,
                value: entry.value,
                ...(entry.line !== undefined && { line: entry.line }),
              },
            };
          })),
    ];
  };

  const items: PickItem<Row>[] = [
    { id: 'header-stores', label: 'Everywhere — yours, in every folder', isHeader: true },
    ...stores.flatMap(placeItems),
    { id: 'header-files', label: 'Env files here — read in order, later wins', isHeader: true },
    ...filePlaces.flatMap(placeItems),
    { id: 'addFile', label: '+ Add a file…', value: { kind: 'addFile' as const } },
    ...(missingDefaults.length
      ? [
          {
            id: 'defaults',
            label: `↺ Add back ${missingDefaults.join(', ')}`,
            value: { kind: 'defaults' as const },
          },
        ]
      : []),
    { id: 'header-projects', label: 'Workspace configs (env.config.ts) — win over the files', isHeader: true },
    ...projectPlaces.flatMap(placeItems),
    ...(hasLocalConfig
      ? []
      : [{ id: 'init', label: '+ Create env.config.ts here', value: { kind: 'init' as const } }]),
  ];
  const current =
    items.find((item) => item.id === currentId && item.value)?.value ??
    items.find((item) => item.value)?.value;
  const placeOfRow = (row: Row | undefined) =>
    row?.kind === 'place' || row?.kind === 'var' ? row.place : undefined;

  // --- places --------------------------------------------------------------------------------

  const toggleFile = (layer: Layer) => {
    if (layer.status === 'disabled') {
      if (layer.disabledBy && layer.disabledBy !== 'config') {
        notify(`${layer.label} is switched off by ${layer.disabledBy} — open it to change that`, 'warn');
        return;
      }
      onConfigChange(enableFile(config, layer, cwd));
      notify(`Reading ${layer.label} again`, 'ok');
    } else {
      onConfigChange(disableFile(config, layer));
      notify(layer.listedBy === 'config' ? `${layer.written} is off — in every folder` : `${layer.label} is off`);
    }
  };

  const addFile = () =>
    prompt.ask('Read another env file (e.g. ".env.local", "~/secrets.env"):', (value) => {
      const path = value.trim();
      if (!path) return;
      if (config.files.includes(path)) {
        notify(`${path} is already in your list`, 'info');
        return;
      }
      onConfigChange({ ...config, files: [...config.files, path] });
      notify(`Reading ${path} last — it wins over the rest`, 'ok');
    });

  const unlistFile = (layer: Layer) => {
    if (layer.listedBy !== 'config' || !layer.written) {
      notify(`${layer.label} comes from ${layer.listedBy} — switch it off with [space] instead`, 'warn');
      return;
    }
    const written = layer.written;
    prompt.confirm(`Stop listing ${written}? (the file itself stays)`, () => {
      onConfigChange({ ...config, files: config.files.filter((entry) => entry !== written) });
      notify(`${written} is out of your list`);
    });
  };

  const reorder = (layer: Layer, by: -1 | 1) => {
    const at = layer.written ? config.files.indexOf(layer.written) : -1;
    if (layer.listedBy !== 'config' || at < 0) return;
    const to = at + by;
    if (to < 0 || to >= config.files.length) return;
    const next = [...config.files];
    [next[at], next[to]] = [next[to] as string, next[at] as string];
    onConfigChange({ ...config, files: next });
  };

  const init = () => {
    const path = join(cwd, 'env.config.ts');
    Bun.write(path, PROJECT_CONFIG_TEMPLATE)
      .then(() => onEdit(path))
      .catch((error: Error) => notify(error.message, 'error'));
  };

  const openPlace = (place: Place) => {
    const path = placePath(place);
    if (path) onEdit(path);
  };

  // --- values --------------------------------------------------------------------------------

  const has = (place: Place, key: string) => !!place.layer?.entries.some((entry) => entry.key === key);

  const addVar = (place: Place) => {
    const location = place.location;
    if (!location) return openPlace(place);
    prompt.ask(`KEY=value into ${locationLabel(location)}:`, (text) => {
      const parsed = parseAssignment(text);
      if (!parsed) {
        notify(`"${text}" is not KEY=value`, 'error');
        return;
      }
      write(
        setTextAt(location, parsed.key, parsed.value, config),
        `${parsed.key} set in ${locationLabel(location)}`,
      );
      select(locationRowId(place.id, parsed.key));
    });
  };

  const editVar = (place: Place, key: string, fallback: string) => {
    const location = place.location;
    if (!location) return openPlace(place);
    readRaw(location, key, config)
      .then((raw) =>
        prompt.ask(
          `${key} in ${locationLabel(location)} =`,
          (text) =>
            write(setTextAt(location, key, text, config, raw?.quote), `${key} set in ${locationLabel(location)}`),
          {
            initial: raw?.text ?? fallback,
            secret: isSecret(key) && !reveal && !isOpRef(raw?.text ?? fallback),
          },
        ),
      )
      .catch((error: Error) => notify(error.message, 'error'));
  };

  const renameVar = (place: Place, key: string) => {
    const location = place.location;
    if (!location) return openPlace(place);
    prompt.ask(
      `Rename ${key} in ${locationLabel(location)} to:`,
      (next) => {
        const name = next.trim();
        if (name === key) return;
        if (!isValidKey(name)) {
          notify(`"${name}" is not a valid name`, 'error');
          return;
        }
        write(renameAt(location, key, name, config), `${key} is ${name} now`);
        select(locationRowId(place.id, name));
      },
      { initial: key },
    );
  };

  const deleteVar = (place: Place, key: string) => {
    const location = place.location;
    if (!location) return openPlace(place);
    prompt.confirm(`Delete ${key} from ${locationLabel(location)}?`, () =>
      write(removeAt(location, key, config), `${key} deleted from ${locationLabel(location)}`),
    );
  };

  /** Move (or copy) a value, as written, to a place picked from the rest. */
  const transfer = (place: Place, key: string, keep: boolean) => {
    const from = place.location;
    if (!from) return notify('An env.config.ts is code — copy the value by hand', 'warn');
    const targets = locations.filter((location) => !sameLocation(location, from));
    const preferred = setTargetLocation(config.setTarget, cwd, locations);
    const verb = keep ? 'Copy' : 'Move';
    picker.open(
      `${verb} ${key} to:`,
      targets,
      (to) => {
        const target = allPlaces.find((candidate) => candidate.id === locationId(to));
        const run = () =>
          write(
            transferVar(from, to, key, config, { keep }),
            `${key} ${keep ? 'copied' : 'moved'} to ${locationLabel(to)}`,
          ).then(() => {
            if (!keep) select(locationRowId(locationId(to), key));
          });
        if (target && has(target, key))
          prompt.confirm(`${locationLabel(to)} already sets ${key} — replace it?`, run);
        else run();
      },
      targets.some((location) => sameLocation(location, preferred)) ? preferred : undefined,
    );
  };

  const copy = (key: string, value: string, withKey = false) => {
    copyToClipboard(withKey ? `${key}=${quoteValue(value)}` : value);
    notify(`Copied ${withKey ? `${key}=…` : `the value of ${key}`}`, 'ok');
  };

  const copySecret = (key: string, value: string) =>
    secrets
      .secretOf(value)
      .then((secret) => {
        copyToClipboard(secret);
        notify(`Copied ${key}'s secret${isOpRef(value) ? ` (read from ${OP_LABEL})` : ''}`, 'ok');
      })
      .catch((error: Error) => notify(error.message, 'error'));

  const showInValues = (key: string) => onJump('values', key);

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'place') toggleFold(row.place);
    else if (row.kind === 'var') editVar(row.place, row.key, row.value);
    else if (row.kind === 'addFile') addFile();
    else if (row.kind === 'defaults') onConfigChange({ ...config, files: [...missingDefaults, ...config.files] });
    else init();
  };

  useInput(
    (input, key) => {
      const place = placeOfRow(current);
      if (input === '/') open();
      else if (key.escape && search) clear();
      else if (input === 'A') addFile();
      else if (key.leftArrow && place) {
        if (!collapsed.has(place.id)) toggleFold(place);
        select(place.id);
      } else if (key.rightArrow && place && collapsed.has(place.id)) toggleFold(place);
      else if (!place || !current) return;
      else if (input === 'a') addVar(place);
      else if (current.kind === 'place') {
        const layer = place.layer;
        if (input === 'o' || input === 'e') openPlace(place);
        else if (place.location?.kind !== 'file' || !layer) return;
        else if (input === ' ') toggleFile(layer);
        else if (input === '[') reorder(layer, -1);
        else if (input === ']') reorder(layer, 1);
        else if (input === 'x') unlistFile(layer);
      } else if (current.kind === 'var') {
        const { key: name, value } = current;
        if (input === 'e') editVar(place, name, value);
        else if (input === 'R') renameVar(place, name);
        else if (input === 'm') transfer(place, name, false);
        else if (input === 'M') transfer(place, name, true);
        else if (input === 'x') deleteVar(place, name);
        else if (input === 'c') copy(name, value);
        else if (input === 'y') copy(name, value, true);
        else if (input === 'C') copySecret(name, value);
        else if (input === 'l') showInValues(name);
        else if (input === 'o') openPlace(place);
      }
    },
    { isActive: !busy },
  );

  // --- detail --------------------------------------------------------------------------------

  const placeActions = (place: Place): ToolbarAction[] => {
    const layer = place.layer;
    const fileLayer = place.location?.kind === 'file' ? layer : undefined;
    const mine = fileLayer?.listedBy === 'config';
    return [
      ...(place.location
        ? [{ hotkey: 'a', label: 'Add var', onPress: () => addVar(place), tone: 'primary' as const }]
        : []),
      ...(fileLayer
        ? [
            {
              hotkey: 'space',
              label: fileLayer.status === 'disabled' ? 'Switch on' : 'Switch off',
              onPress: () => toggleFile(fileLayer),
            },
          ]
        : []),
      {
        hotkey: 'o',
        label: fileLayer?.status === 'missing' ? 'Create in editor' : 'Open in editor',
        onPress: () => openPlace(place),
        ...(place.location ? {} : { tone: 'primary' as const }),
      },
      ...(fileLayer && mine
        ? [
            { hotkey: '[', label: 'Earlier', onPress: () => reorder(fileLayer, -1) },
            { hotkey: ']', label: 'Later', onPress: () => reorder(fileLayer, 1) },
            { hotkey: 'x', label: 'Unlist', onPress: () => unlistFile(fileLayer), tone: 'danger' as const },
          ]
        : []),
    ];
  };

  const renderPlace = (place: Place) => {
    const layer = place.layer;
    const path = placePath(place);
    const about =
      place.location?.kind === 'config'
        ? 'Your vars: applied in every folder, under its env files — a project can still override them. Kept in envi’s config, the file dotfiles keep.'
        : place.location?.kind === 'state'
          ? 'Machine vars: like your vars, applied after them, but kept in the state file — this machine only, never in dotfiles.'
          : place.project
            ? 'Code, so it is edited in the editor: its vars win over every env file; files and disable change what is read.'
            : [
                layer?.listedBy === 'config' ? 'in your list' : `listed by ${layer?.listedBy}`,
                layer?.status === 'disabled'
                  ? `switched off${layer.disabledBy === 'config' ? ' in your config' : ` by ${layer.disabledBy}`}`
                  : '',
                layer?.status === 'missing' ? 'does not exist yet — [a] or [o] creates it' : '',
                layer?.error ?? '',
              ]
                .filter(Boolean)
                .join(' · ');
    const { project } = place;
    return (
      <Box flexDirection="column">
        <Toolbar actions={placeActions(place)} />
        <Text color={colors.muted} wrap="truncate-middle">
          {tilde(path ?? '')}
        </Text>
        <Text color={colors.muted} wrap="wrap">
          {about}
        </Text>
        {layer?.errors.map((error) => (
          <Text key={error.line} color={colors.error} wrap="truncate">
            {`line ${error.line}: ${error.message}`}
          </Text>
        ))}
        {project && (
          <Box flexDirection="column" marginTop={1}>
            {project.error ? (
              <Text color={colors.error} wrap="wrap">
                {project.error}
              </Text>
            ) : (
              <>
                {project.files.length > 0 && <Text color={colors.text}>{`files: ${project.files.join(', ')}`}</Text>}
                {project.disable.length > 0 && (
                  <Text color={colors.text}>{`disable: ${project.disable.join(', ')}`}</Text>
                )}
                {project.required.length > 0 && (
                  <Text color={colors.text}>{`required: ${project.required.join(', ')}`}</Text>
                )}
                {project.override !== undefined && <Text color={colors.text}>{`override: ${project.override}`}</Text>}
              </>
            )}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={colors.muted} wrap="wrap">
            {`${layer?.entries.length ?? 0} values, listed under it — ←/→ or Enter folds.${place.location ? ` A value written as ${OP_PREFIX}vault/item/field is read from ${OP_LABEL} only when a command needs it.` : ''}`}
          </Text>
        </Box>
      </Box>
    );
  };

  const varActions = (row: Extract<Row, { kind: 'var' }>): ToolbarAction[] => {
    const { place, key, value } = row;
    const writable = Boolean(place.location);
    return [
      {
        hotkey: 'e',
        label: writable ? 'Edit' : 'Edit config',
        onPress: () => editVar(place, key, value),
        tone: 'primary',
      },
      ...(writable
        ? [
            { hotkey: 'm', label: 'Move to…', onPress: () => transfer(place, key, false) },
            { hotkey: 'M', label: 'Copy to…', onPress: () => transfer(place, key, true) },
            { hotkey: 'R', label: 'Rename', onPress: () => renameVar(place, key) },
          ]
        : []),
      { hotkey: 'c', label: isOpRef(value) ? 'Copy reference' : 'Copy', onPress: () => copy(key, value) },
      ...(isOpRef(value) ? [{ hotkey: 'C', label: 'Copy secret', onPress: () => copySecret(key, value) }] : []),
      { hotkey: 'l', label: 'Show in Values', onPress: () => showInValues(key) },
      ...(writable
        ? [{ hotkey: 'x', label: 'Delete', onPress: () => deleteVar(place, key), tone: 'danger' as const }]
        : []),
    ];
  };

  const renderVar = (row: Extract<Row, { kind: 'var' }>) => {
    const { place, key, value, line } = row;
    const winner = winnerOf(key);
    const won = wins(place, key, line);
    const fate = !winner
      ? 'not applied'
      : !won
        ? `overridden by ${where(winner.source)}`
        : winner.status === 'kept'
          ? 'the shell exports its own value, which wins (override is off)'
          : `applied here — ${STATUS_TEXT[winner.status]}`;
    const elsewhere = winner
      ? [...winner.shadowed, winner.source].filter(
          (source) => !(source.layerId === place.id && source.line === line),
        )
      : [];
    const show = (text: string) => preview(secrets.shown(text, reveal), isSecret(key), reveal);
    return (
      <Box flexDirection="column">
        <Toolbar actions={varActions(row)} />
        <Text color={colors.muted} wrap="truncate">
          {`in ${placeName(place)}${line ? `:${line}` : ''}`}
        </Text>
        <Text color={won && winner?.status !== 'kept' ? colors.ok : colors.warn} wrap="wrap">
          {fate}
        </Text>
        <Box marginTop={1}>
          <ValueBlock
            name={key}
            value={value}
            secret={isSecret(key)}
            reveal={reveal}
            {...secrets.blockProps(value)}
            onReveal={onToggleReveal}
            onCopySecret={() => copySecret(key, value)}
          />
        </Box>
        {(elsewhere.length > 0 || winner?.shell !== undefined) && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={colors.heading}>Also set</Text>
            {elsewhere.map((source) => (
              <Text key={`${source.layerId}:${source.line ?? ''}`} color={colors.muted} wrap="truncate">
                {`  ${where(source)}  ${show(source.value)}`}
              </Text>
            ))}
            {winner?.shell !== undefined && (
              <Text color={colors.muted} wrap="truncate">
                {`  shell  ${show(winner.shell)}`}
              </Text>
            )}
          </Box>
        )}
      </Box>
    );
  };

  const detail = (row: Row) => {
    switch (row.kind) {
      case 'place':
        return renderPlace(row.place);
      case 'var':
        return renderVar(row);
      case 'addFile':
        return (
          <Text color={colors.muted} wrap="wrap">
            A path from the folder envi runs in (".env.local"), or an absolute or ~/ one for a file
            shared by every folder. It is read after the others, so its values win.
          </Text>
        );
      case 'defaults':
        return (
          <Text color={colors.muted} wrap="wrap">
            {`List ${missingDefaults.join(' and ')} again, ahead of your own files.`}
          </Text>
        );
      case 'init':
        return (
          <Text color={colors.muted} wrap="wrap">
            Write a commented env.config.ts template here and open it. It applies to this folder and
            everything below it, after the git root's own; its vars win over every .env file.
          </Text>
        );
    }
  };

  const valueCount = allPlaces.reduce((sum, place) => sum + (place.layer?.entries.length ?? 0), 0);
  const header = picker.line ?? prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {[
        `${allPlaces.length} places · ${valueCount} values`,
        search ? `matching "${search}"` : '',
        '● wins · ○ overridden · ⚙ listed by env.config.ts · ←/→ fold',
      ]
        .filter(Boolean)
        .join(' · ')}
    </Text>
  );

  const detailTitle =
    current?.kind === 'var'
      ? current.key
      : current?.kind === 'place'
        ? placeName(current.place)
        : 'Locations';

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => `${item.id}${item.hint ?? ''}`).join(',')}
        title={`Locations (${allPlaces.length})`}
        items={items}
        emptyText={isLoading ? 'Reading the layers…' : 'Nothing here.'}
        detailTitle={detailTitle}
        reservedChrome={['viewHeader']}
        activateLabel={current?.kind === 'place' ? 'fold' : current?.kind === 'var' ? 'edit' : 'add'}
        //? An action row (add a file, add back the defaults, create env.config.ts) runs on a click,
        //? as on Enter; a place or a value only selects, so a click never edits or folds by accident
        activateOnClick={(item) => item.value?.kind !== 'place' && item.value?.kind !== 'var'}
        initialSelectedId={currentId}
        isInputActive={!busy}
        hints={[
          { key: 'a', label: 'add var', onPress: () => { const place = placeOfRow(current); if (place) addVar(place); } },
          { key: 'A', label: 'add file', onPress: addFile },
          ...searchHints,
          ...(current?.kind === 'var'
            ? [{ key: 'y', label: 'copy KEY=value', onPress: () => copy(current.key, current.value, true) }]
            : []),
        ]}
        onActivate={(item) => activate(item.value)}
        onSelectionChange={(item) => select(item?.id)}
        renderDetail={(item) => (item?.value ? detail(item.value) : null)}
      />
    </Box>
  );
};

export default LocationsView;

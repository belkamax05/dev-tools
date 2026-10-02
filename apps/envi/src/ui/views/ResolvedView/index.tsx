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

import { isSecretKey, touchStamp, withoutVar, withVar } from '../../../config/settings';
import { removeFromEnvFile, setInEnvFile } from '../../../core/envFile';
import type { ResolvedVar, VarSource, VarStatus } from '../../../core/resolve';
import { matchesSearch } from '../../../core/search';
import type { ViewProps } from '../../App';
import useSearch from '../../useSearch';
import ValueBlock from '../../ValueBlock';
import { preview } from '../ShellView';

type Row = { kind: 'var'; entry: ResolvedVar } | { kind: 'missing'; key: string; from: string };

export const STATUS_TEXT: Record<VarStatus, string> = {
  new: '+ new',
  changed: '~ replaces shell',
  same: '= same as shell',
  kept: '⊘ shell wins',
};

const where = (source: VarSource) =>
  source.line ? `${source.label}:${source.line}` : source.label;

/**
 * What envi sets here — every variable some layer defines, with the layer that won, the ones it
 * beat, and how it compares with the shell. Required variables nothing sets are listed first.
 *
 * From here a value can be overridden for this folder (`.env.user`) or everywhere (your vars),
 * and the line that set it can be removed or opened in the editor.
 */
export const ResolvedView = ({
  resolution,
  isLoading,
  config,
  cwd,
  session,
  reveal,
  notify,
  reload,
  onConfigChange,
  onCaptureInput,
  onEdit,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const { search, open, clear, hints: searchHints } = useSearch(session, 'resolved', prompt);
  const [currentId, setCurrentId] = useState(session.selected.resolved);

  const vars = (resolution?.vars ?? []).filter((entry) =>
    matchesSearch(entry.key, entry.value, search),
  );
  const missing = (resolution?.missing ?? []).filter((entry) =>
    matchesSearch(entry.key, '', search),
  );

  const statusColor = (status: VarStatus) =>
    status === 'new'
      ? colors.ok
      : status === 'changed'
        ? colors.warn
        : status === 'kept'
          ? colors.muted
          : undefined;

  const items: PickItem<Row>[] = [
    ...(missing.length
      ? [
          {
            id: 'header-missing',
            label: `Missing (${missing.length})`,
            isHeader: true,
          },
          ...missing.map((entry) => ({
            id: `missing:${entry.key}`,
            label: `✗ ${entry.key}`,
            hint: `required by ${entry.from}`,
            hintColor: colors.error,
            value: { kind: 'missing' as const, ...entry },
          })),
          {
            id: 'header-vars',
            label: `Set by envi (${vars.length})`,
            isHeader: true,
          },
        ]
      : []),
    ...vars.map((entry) => {
      const secret = isSecretKey(entry.key, config.maskPatterns);
      return {
        id: entry.key,
        label: `${entry.status === 'kept' ? '○' : '●'} ${entry.key}`,
        hint:
          entry.status === 'kept'
            ? STATUS_TEXT.kept
            : `${preview(entry.value, secret, reveal).slice(0, 60)}`,
        hintColor: statusColor(entry.status),
        value: { kind: 'var' as const, entry },
      };
    }),
  ];
  const current =
    items.find((item) => item.id === currentId && item.value)?.value ??
    items.find((item) => item.value)?.value;

  const afterWrite = (message: string) => () =>
    touchStamp().then(() => {
      notify(message, 'ok');
      reload();
    });

  const setHere = (key: string, initial = '') =>
    prompt.ask(
      `${key} in .env.user here =`,
      (value) => {
        setInEnvFile(join(cwd, '.env.user'), key, value)
          .then(afterWrite(`${key} set in .env.user`))
          .catch((error: Error) => notify(error.message, 'error'));
      },
      { initial },
    );

  const setGlobal = (key: string, initial = '') =>
    prompt.ask(
      `${key} in your vars =`,
      (value) => {
        onConfigChange({ ...config, vars: withVar(config.vars, key, value) });
        notify(`${key} set in your vars`, 'ok');
      },
      { initial },
    );

  /** Delete the winning line — the next layer down (or the shell) takes over. */
  const removeSource = (entry: ResolvedVar) => {
    const { source } = entry;
    if (source.kind === 'project') {
      if (source.path) onEdit(source.path);
      return;
    }
    const next = entry.shadowed.at(-1);
    const fallback = next
      ? `${where(next)} takes over`
      : entry.shell !== undefined
        ? 'the shell’s value stays'
        : 'it will be unset';
    prompt.confirm(`Remove ${entry.key} from ${where(source)}? (${fallback})`, () => {
      if (source.kind === 'user') {
        onConfigChange({
          ...config,
          vars: withoutVar(config.vars, entry.key),
        });
        notify(`${entry.key} removed from your vars`, 'ok');
        return;
      }
      if (source.path) {
        removeFromEnvFile(source.path, entry.key)
          .then(afterWrite(`${entry.key} removed from ${source.label}`))
          .catch((error: Error) => notify(error.message, 'error'));
      }
    });
  };

  const copy = (row: Row | undefined) => {
    if (row?.kind !== 'var') return;
    copyToClipboard(row.entry.value);
    notify(`Copied the value of ${row.entry.key}`, 'ok');
  };

  const keyOf = (row: Row | undefined) => (row?.kind === 'var' ? row.entry.key : row?.key);
  const rowValue = (row: Row | undefined) => (row?.kind === 'var' ? row.entry.value : '');

  useInput(
    (input, key) => {
      const name = keyOf(current);
      if (input === '/') open();
      else if (key.escape && search) clear();
      else if (!name) return;
      else if (input === 'c') copy(current);
      else if (input === 's') setHere(name, rowValue(current));
      else if (input === 'g') setGlobal(name, rowValue(current));
      else if (input === 'x' && current?.kind === 'var') removeSource(current.entry);
      else if (input === 'o' && current?.kind === 'var' && current.entry.source.path)
        onEdit(current.entry.source.path);
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (row: Row): ToolbarAction[] => {
    if (row.kind === 'missing') {
      return [
        {
          hotkey: 's',
          label: 'Set in .env.user',
          onPress: () => setHere(row.key),
          tone: 'primary',
        },
        {
          hotkey: 'g',
          label: 'Set in your vars',
          onPress: () => setGlobal(row.key),
        },
      ];
    }
    const { entry } = row;
    return [
      { hotkey: 'c', label: 'Copy', onPress: () => copy(row), tone: 'primary' },
      {
        hotkey: 's',
        label: 'Override here',
        onPress: () => setHere(entry.key, entry.value),
      },
      {
        hotkey: 'g',
        label: 'Set in your vars',
        onPress: () => setGlobal(entry.key, entry.value),
      },
      ...(entry.source.path
        ? [
            {
              hotkey: 'o',
              label: 'Open source',
              onPress: () => onEdit(entry.source.path ?? ''),
            },
          ]
        : []),
      {
        hotkey: 'x',
        label: entry.source.kind === 'project' ? 'Edit config' : 'Remove',
        onPress: () => removeSource(entry),
        tone: 'danger',
      },
    ];
  };

  const renderVar = (entry: ResolvedVar) => {
    const secret = isSecretKey(entry.key, config.maskPatterns);
    const show = (value: string) => preview(value, secret, reveal);
    return (
      <Box flexDirection="column">
        <Text color={statusColor(entry.status) ?? colors.text} bold>
          {STATUS_TEXT[entry.status]}
        </Text>
        <Box marginTop={1}>
          <ValueBlock
            name={entry.key}
            value={entry.value}
            secret={secret}
            reveal={reveal}
            maxLines={6}
          />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.heading}>Layers</Text>
          {entry.shadowed.map((source) => (
            <Text
              key={`${source.layerId}:${source.line ?? ''}`}
              color={colors.muted}
              wrap="truncate"
            >
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

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {resolution
        ? `${resolution.vars.length} from ${resolution.layers.filter((layer) => layer.status === 'loaded').length} layers${search ? ` · ${vars.length} match "${search}"` : ''}${resolution.missing.length ? ` · ${resolution.missing.length} required missing` : ''}`
        : 'Reading the layers…'}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        title={`Resolved (${vars.length})`}
        items={items}
        emptyText={
          isLoading && !resolution
            ? 'Reading the layers…'
            : search
              ? 'Nothing matches — Esc clears the search.'
              : 'envi sets nothing here. The Files tab shows what it reads; Your vars adds some.'
        }
        detailTitle={keyOf(current) ?? 'Variable'}
        reservedChrome={['viewHeader']}
        activateLabel="copy"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={searchHints}
        onActivate={(item) => copy(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.resolved = item?.id;
        }}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} />
              {row.kind === 'missing' ? (
                <Text color={colors.error} wrap="wrap">
                  {`Required by ${row.from}, and nothing sets it — not the shell, not a layer.`}
                </Text>
              ) : (
                renderVar(row.entry)
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default ResolvedView;

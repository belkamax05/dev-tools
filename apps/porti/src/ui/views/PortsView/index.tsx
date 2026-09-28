import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { type PortiConfig, parsePort, withoutPort, withPort } from '../../../config/settings';
import {
  describeOwner,
  isBusy,
  type PortOwner,
  type PortStatus,
  stopPid,
  stopPort,
} from '../../../core/ports';
import type { Session, Tone } from '../../types';

export interface PortsViewProps {
  /** `watched`: the configured ports, free or not. `listening`: every port something holds. */
  mode: 'watched' | 'listening';
  statuses: PortStatus[];
  isLoading: boolean;
  config: PortiConfig;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  reload: () => void;
  onConfigChange: (config: PortiConfig) => void;
  onCaptureInput: (captured: boolean) => void;
}

const formatRss = (kib: number) =>
  kib >= 1024 * 1024 ? `${(kib / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kib / 1024)} MB`;

const ownerSummary = (status: PortStatus) => {
  if (status.owners.length) {
    const [first] = status.owners;
    const more = status.owners.length > 1 ? ` +${status.owners.length - 1}` : '';
    return first ? `${describeOwner(first)}${more}` : '';
  }
  return status.hiddenOwner ? 'another user' : 'free';
};

const matches = (status: PortStatus, filter: string) => {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return [
    String(status.port),
    status.name ?? '',
    ...status.owners.map((owner) => owner.process?.command ?? owner.command ?? ''),
  ].some((text) => text.toLowerCase().includes(needle));
};

/** `"5173 vite"` → `{ port: 5173, name: 'vite' }`. */
const parseEntry = (text: string) => {
  const [portText, ...name] = text.trim().split(/\s+/);
  const port = parsePort(portText);
  if (port === undefined) return undefined;
  const label = name.join(' ').trim();
  return label ? { port, name: label } : { port };
};

const OwnerDetail = ({ owner }: { owner: PortOwner }) => {
  const colors = useColors();
  const proc = owner.process;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={colors.heading}>
        {describeOwner(owner)}
      </Text>
      {proc ? (
        <>
          <Text color={colors.muted} wrap="truncate">
            {`user ${proc.user} · cpu ${proc.cpu.toFixed(1)}% · mem ${proc.mem.toFixed(1)}% · ${formatRss(proc.rss)} · up ${proc.elapsed}`}
          </Text>
          <Text color={colors.text} wrap="wrap">
            {proc.command}
          </Text>
        </>
      ) : (
        <Text color={colors.muted}>
          Exited since the last refresh, or not visible to this user.
        </Text>
      )}
      {owner.parent && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colors.muted}>{`parent ${owner.parent.name} (${owner.parent.pid})`}</Text>
          <Text color={colors.muted} wrap="truncate-end">
            {owner.parent.command}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * A list of ports beside what holds each one, with the ways to stop it.
 *
 * Stopping always asks first and always re-reads the port before signalling (see `stopPort`), so
 * a confirmation answered after the port changed hands cannot kill the newcomer. The list is keyed
 * on its row ids, so a refresh that adds or drops a port remounts it on the row the cursor was
 * on, rather than leaving the cursor on whatever slid into its old position.
 */
export const PortsView = ({
  mode,
  statuses,
  isLoading,
  config,
  session,
  notify,
  reload,
  onConfigChange,
  onCaptureInput,
}: PortsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState(session.filter);

  const rows =
    mode === 'watched'
      ? statuses.filter((status) => status.watched)
      : statuses.filter((status) => isBusy(status) && matches(status, filter));
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected[mode]);
  const current = rows.find((status) => String(status.port) === currentId) ?? rows[0];

  const items: PickItem<PortStatus>[] = rows.map((status) => {
    const taken = isBusy(status);
    return {
      id: String(status.port),
      label: `${taken ? '●' : '○'} ${String(status.port).padStart(5)}  ${ownerSummary(status)}`,
      hint:
        mode === 'watched'
          ? status.name
          : status.watched
            ? `★ ${status.name ?? 'watched'}`
            : undefined,
      hintColor: taken ? colors.warn : colors.ok,
      value: status,
    };
  });

  const run = async (label: string, action: () => Promise<{ ok: boolean; message: string }[]>) => {
    setBusy(true);
    notify(`${label}…`);
    try {
      const results = await action();
      if (!results.length) notify('Nothing to stop — the port is free now', 'info');
      else {
        const failed = results.filter((result) => !result.ok);
        notify(results.map((result) => result.message).join(' · '), failed.length ? 'error' : 'ok');
      }
    } finally {
      setBusy(false);
      reload();
    }
  };

  const stop = (
    status: PortStatus | undefined,
    options: { force?: boolean; tree?: boolean } = {},
  ) => {
    if (!status || busy) return;
    if (!status.owners.length) {
      notify(
        status.hiddenOwner
          ? `${status.port} is held by another user's process — run porti with sudo to stop it`
          : `${status.port} is free`,
        status.hiddenOwner ? 'warn' : 'info',
      );
      return;
    }
    const how = options.force ? 'SIGKILL now' : 'SIGTERM, SIGKILL after 2s';
    const what = `${status.owners.map(describeOwner).join(', ')}${options.tree ? ' and its children' : ''}`;
    prompt.confirm(
      `${options.force ? 'Kill' : 'Stop'} ${what} on :${status.port} (${how})?`,
      () => void run(`Stopping :${status.port}`, () => stopPort(status.port, options)),
    );
  };

  const stopParent = (status: PortStatus | undefined) => {
    const parent = status?.owners.find((owner) => owner.parent)?.parent;
    if (!status || !parent || busy) return;
    if (parent.pid <= 1) {
      notify(`${status.port}'s owner has no parent worth stopping (pid ${parent.pid})`, 'warn');
      return;
    }
    prompt.confirm(
      `Stop the parent ${parent.name} (${parent.pid}) — usually the watcher that restarts :${status.port}?`,
      () => void run(`Stopping ${parent.pid}`, async () => [await stopPid(parent.pid)]),
    );
  };

  const toggleWatch = (status: PortStatus | undefined) => {
    if (!status) return;
    if (status.watched) {
      onConfigChange({ ...config, ports: withoutPort(config.ports, status.port) });
      notify(`No longer watching ${status.port}`);
    } else {
      onConfigChange({ ...config, ports: withPort(config.ports, { port: status.port }) });
      notify(`Watching ${status.port}`, 'ok');
    }
  };

  const rename = (status: PortStatus | undefined) => {
    if (!status?.watched) return;
    prompt.ask(
      `Name for ${status.port}:`,
      (value) => {
        const name = value.trim();
        onConfigChange({
          ...config,
          ports: withPort(config.ports, name ? { port: status.port, name } : { port: status.port }),
        });
      },
      { initial: status.name ?? '' },
    );
  };

  const addPort = () =>
    prompt.ask('Watch port (e.g. "5173 vite"):', (value) => {
      const entry = parseEntry(value);
      if (!entry) {
        notify(`"${value}" does not start with a port (1-65535)`, 'error');
        return;
      }
      onConfigChange({ ...config, ports: withPort(config.ports, entry) });
      notify(`Watching ${entry.port}${entry.name ? ` (${entry.name})` : ''}`, 'ok');
    });

  const askFilter = () =>
    prompt.ask(
      'Filter (port, name or command):',
      (value) => {
        setFilter(value.trim());
        session.filter = value.trim();
      },
      { initial: filter },
    );

  useInput(
    (input, key) => {
      if (busy) return;
      if (input === 'k') stop(current);
      else if (input === 'K') stop(current, { force: true });
      else if (input === 'g') stop(current, { tree: true });
      else if (input === 'p') stopParent(current);
      else if (input === 'w') toggleWatch(current);
      else if (input === 'n') rename(current);
      else if (input === 'a') addPort();
      else if (input === '/' && mode === 'listening') askFilter();
      else if (key.escape && filter) {
        setFilter('');
        session.filter = '';
      }
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (status: PortStatus): ToolbarAction[] => {
    const owned = status.owners.length > 0;
    const hasParent = status.owners.some((owner) => owner.parent && owner.parent.pid > 1);
    return [
      ...(owned
        ? [
            { hotkey: 'k', label: 'Stop', onPress: () => stop(status), tone: 'primary' as const },
            {
              hotkey: 'K',
              label: 'Kill now',
              onPress: () => stop(status, { force: true }),
              tone: 'danger' as const,
            },
            { hotkey: 'g', label: 'Stop + children', onPress: () => stop(status, { tree: true }) },
            ...(hasParent
              ? [{ hotkey: 'p', label: 'Stop parent', onPress: () => stopParent(status) }]
              : []),
          ]
        : []),
      {
        hotkey: 'w',
        label: status.watched ? 'Unwatch' : 'Watch',
        onPress: () => toggleWatch(status),
      },
      ...(status.watched ? [{ hotkey: 'n', label: 'Rename', onPress: () => rename(status) }] : []),
    ].map((action) => ({ ...action, disabled: busy }));
  };

  const hints: Hint[] = [
    { key: 'a', label: 'watch port', onPress: addPort },
    ...(mode === 'listening'
      ? [{ key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter }]
      : []),
    ...(filter && mode === 'listening'
      ? [
          {
            key: 'Esc',
            label: 'clear',
            onPress: () => {
              setFilter('');
              session.filter = '';
            },
          },
        ]
      : []),
  ];

  const busyCount = rows.filter(isBusy).length;
  const header = prompt.line ?? (
    <Text color={busy ? colors.warn : colors.muted} wrap="truncate">
      {mode === 'watched'
        ? `${rows.length} watched · ${busyCount} busy · ${rows.length - busyCount} free`
        : `${rows.length} listening${filter ? ` matching "${filter}"` : ''}`}
      {busy ? ' · working…' : ''}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        //? Remount when the set of rows changes, restoring the cursor by id — see above
        key={items.map((item) => item.id).join(',')}
        title={mode === 'watched' ? `Watched (${rows.length})` : `Listening (${rows.length})`}
        items={items}
        emptyText={
          isLoading && !statuses.length
            ? 'Reading the socket table…'
            : mode === 'watched'
              ? 'No ports watched — [a] adds one.'
              : filter
                ? 'Nothing listening matches the filter.'
                : 'Nothing is listening.'
        }
        detailTitle={
          current ? `:${current.port}${current.name ? ` — ${current.name}` : ''}` : 'Port'
        }
        reservedChrome={['viewHeader']}
        activateLabel="stop"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => stop(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected[mode] = item?.id;
        }}
        renderDetail={(item) => {
          const status = item?.value;
          if (!status) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(status)} />
              <Text color={isBusy(status) ? colors.warn : colors.ok} bold>
                {isBusy(status) ? `Port ${status.port} is taken` : `Port ${status.port} is free`}
              </Text>
              {status.addresses.length > 0 && (
                <Text color={colors.muted} wrap="truncate">
                  {`bound on ${status.addresses.join(', ')}`}
                </Text>
              )}
              {status.hiddenOwner && (
                <Text color={colors.warn} wrap="wrap">
                  Also held by a process of another user — run porti with sudo to see and stop it.
                </Text>
              )}
              {status.owners.map((owner) => (
                <OwnerDetail key={owner.pid} owner={owner} />
              ))}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default PortsView;

import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ClearDataDialog, {
  ClearButton,
  type ClearResult,
  type ClearTarget,
} from '@/dev-tools/ui/components/ClearDataDialog';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  DEFAULT_PORTS,
  DEFAULT_REFRESH_SECONDS,
  type PortiConfig,
  parsePort,
  REFRESH_CHOICES,
  type WatchedPort,
  withoutPort,
  withPort,
} from '../../../config/settings';
import portiTheme from '../../theme';
import type { Session, Tone } from '../../types';

export interface SettingsViewProps {
  config: PortiConfig;
  configPath: string;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  onConfigChange: (config: PortiConfig) => void;
  onCaptureInput: (captured: boolean) => void;
  onEditConfig: () => void;
  /** The files the Clear dialog offers — porti's config and state stores. */
  clearTargets: ClearTarget[];
  /** Called once the dialog has cleared files; the app quits so nothing writes them back. */
  onCleared: (results: ClearResult[]) => void;
}

type Setting =
  | { kind: 'port'; entry: WatchedPort }
  | { kind: 'add' }
  | { kind: 'defaults' }
  | { kind: 'theme'; id: string }
  | { kind: 'refresh'; seconds: number }
  | { kind: 'file' }
  | { kind: 'clear' };

const refreshLabel = (seconds: number) => (seconds === 0 ? 'Off' : `Every ${seconds}s`);

/**
 * What porti watches and how it looks: the watched ports (the list the Watched tab and a bare
 * `porti list` show), the theme and the refresh rate — all saved to `config.json` as they change,
 * the file `porti watch`/`unwatch` write too.
 */
export const SettingsView = ({
  config,
  configPath,
  session,
  notify,
  onConfigChange,
  onCaptureInput,
  onEditConfig,
  clearTargets,
  onCleared,
}: SettingsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [current, setCurrent] = useState<Setting | undefined>(undefined);
  const [clearing, setClearing] = useState(false);

  const addPort = () =>
    prompt.ask('Watch port (e.g. "5173 vite"):', (value) => {
      const [portText, ...name] = value.trim().split(/\s+/);
      const port = parsePort(portText);
      if (port === undefined) {
        notify(`"${value}" does not start with a port (1-65535)`, 'error');
        return;
      }
      const label = name.join(' ').trim();
      onConfigChange({
        ...config,
        ports: withPort(config.ports, label ? { port, name: label } : { port }),
      });
      notify(`Watching ${port}`, 'ok');
    });

  const rename = (entry: WatchedPort) =>
    prompt.ask(
      `Name for ${entry.port}:`,
      (value) => {
        const name = value.trim();
        onConfigChange({
          ...config,
          ports: withPort(config.ports, name ? { port: entry.port, name } : { port: entry.port }),
        });
      },
      { initial: entry.name ?? '' },
    );

  const remove = (entry: WatchedPort) =>
    prompt.confirm(`Stop watching ${entry.port}?`, () => {
      onConfigChange({ ...config, ports: withoutPort(config.ports, entry.port) });
      notify(`No longer watching ${entry.port}`);
    });

  const restoreDefaults = () =>
    prompt.confirm(
      `Add back ${DEFAULT_PORTS.map((entry) => entry.port).join(', ')} (your own ports stay)?`,
      () =>
        onConfigChange({
          ...config,
          ports: DEFAULT_PORTS.reduce(
            (ports, entry) =>
              ports.some((existing) => existing.port === entry.port)
                ? ports
                : withPort(ports, entry),
            config.ports,
          ),
        }),
    );

  const apply = (setting: Setting | undefined) => {
    if (!setting) return;
    if (setting.kind === 'port') rename(setting.entry);
    else if (setting.kind === 'add') addPort();
    else if (setting.kind === 'defaults') restoreDefaults();
    else if (setting.kind === 'theme') onConfigChange({ ...config, theme: setting.id });
    else if (setting.kind === 'refresh')
      onConfigChange({ ...config, refreshSeconds: setting.seconds });
    else if (setting.kind === 'clear') setClearing(true);
    else onEditConfig();
  };

  useInput(
    (input) => {
      if (input === ' ') apply(current);
      else if (input === 'a') addPort();
      else if (input === 'e') onEditConfig();
      else if (input === 'X') setClearing(true);
      else if (current?.kind === 'port' && (input === 'x' || input === 'd')) remove(current.entry);
      else if (current?.kind === 'port' && input === 'n') rename(current.entry);
    },
    { isActive: !prompt.isOpen && !clearing },
  );

  const items: PickItem<Setting>[] = [
    { id: 'header-ports', label: `Watched ports (${config.ports.length})`, isHeader: true },
    ...config.ports.map((entry) => ({
      id: `port:${entry.port}`,
      label: `${String(entry.port).padStart(5)}  ${entry.name ?? ''}`,
      value: { kind: 'port' as const, entry },
    })),
    { id: 'add', label: '+ Watch another port…', value: { kind: 'add' as const } },
    ...(DEFAULT_PORTS.every((entry) =>
      config.ports.some((existing) => existing.port === entry.port),
    )
      ? []
      : [
          {
            id: 'defaults',
            label: '↺ Add back the defaults',
            value: { kind: 'defaults' as const },
          },
        ]),
    { id: 'header-theme', label: 'Theme', isHeader: true },
    ...portiTheme.palettes.map((theme) => ({
      id: `theme:${theme.id}`,
      label: theme.label,
      hint: theme.id === config.theme ? 'in use' : undefined,
      hintColor: colors.accent,
      isCurrent: theme.id === config.theme,
      value: { kind: 'theme' as const, id: theme.id },
    })),
    { id: 'header-refresh', label: 'Auto refresh', isHeader: true },
    ...REFRESH_CHOICES.map((seconds) => ({
      id: `refresh:${seconds}`,
      label: refreshLabel(seconds),
      hint: [
        seconds === DEFAULT_REFRESH_SECONDS ? 'recommended' : '',
        seconds === config.refreshSeconds ? 'in use' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      hintColor: seconds === config.refreshSeconds ? colors.accent : undefined,
      isCurrent: seconds === config.refreshSeconds,
      value: { kind: 'refresh' as const, seconds },
    })),
    { id: 'header-file', label: 'Config file', isHeader: true },
    { id: 'file', label: 'Open in $EDITOR', value: { kind: 'file' as const } },
    { id: 'header-reset', label: 'Reset', isHeader: true },
    {
      id: 'clear',
      label: 'Clear settings & state…',
      hintColor: colors.error,
      hint: 'X',
      value: { kind: 'clear' as const },
    },
  ];

  const detail = (setting: Setting) => {
    switch (setting.kind) {
      case 'port':
        return (
          <Box flexDirection="column">
            <Toolbar
              actions={[
                {
                  hotkey: 'n',
                  label: 'Rename',
                  onPress: () => rename(setting.entry),
                  tone: 'primary',
                },
                {
                  hotkey: 'x',
                  label: 'Unwatch',
                  onPress: () => remove(setting.entry),
                  tone: 'danger',
                },
              ]}
            />
            <Text bold color={colors.accent}>
              {setting.entry.port}
            </Text>
            <Text color={colors.muted}>{setting.entry.name ?? 'No name — [n] gives it one.'}</Text>
          </Box>
        );
      case 'add':
        return (
          <Text color={colors.muted} wrap="wrap">
            A port and an optional name — "5173 vite". Watched ports are listed on the Watched tab
            whether anything holds them or not, and are what a bare `porti list` shows.
          </Text>
        );
      case 'defaults':
        return (
          <Text color={colors.muted} wrap="wrap">
            {`Watch ${DEFAULT_PORTS.map((entry) => entry.port).join(', ')} again — the ports porti starts with. Nothing you added is removed.`}
          </Text>
        );
      case 'theme': {
        const theme = portiTheme.palettes.find((candidate) => candidate.id === setting.id);
        return (
          <Box flexDirection="column">
            <Text bold color={theme?.colors.accent}>
              {theme?.label}
            </Text>
            <Text color={colors.muted}>{theme?.blurb}</Text>
          </Box>
        );
      }
      case 'refresh':
        return (
          <Text color={colors.muted} wrap="wrap">
            {setting.seconds === 0
              ? 'The tables are read when porti opens, after an action and on [r] — never on their own.'
              : `The socket and process tables are re-read every ${setting.seconds}s. The timer stops while a question is on screen, so the row it is about cannot change under it.`}
          </Text>
        );
      case 'clear':
        return (
          <Text color={colors.muted} wrap="wrap">
            Remove porti's config (theme, refresh rate, watched ports) and state (last tab) from
            disk, after a confirmation that lists both. porti quits afterwards and starts from its
            defaults next time.
          </Text>
        );
      case 'file':
        return (
          <Box flexDirection="column">
            <Text color={colors.text}>{configPath}</Text>
            <Text color={colors.muted} wrap="wrap">
              Plain JSON, safe to keep in dotfiles. `ports` is a list of {'{ "port", "name" }'} or
              bare numbers. The last tab is kept apart, in porti's state directory.
            </Text>
          </Box>
        );
    }
  };

  if (clearing) {
    return (
      <ClearDataDialog
        title="Clear porti's settings and state"
        targets={clearTargets}
        onDone={onCleared}
        onCancel={() => setClearing(false)}
        onCaptureInput={onCaptureInput}
      />
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text color={colors.muted} wrap="truncate">
            Changes are saved as they are made
          </Text>
        )}
      </Box>
      <ListDetail
        key={config.ports.map((entry) => entry.port).join(',')}
        title="Settings"
        items={items}
        detailTitle="Setting"
        reservedChrome={['viewHeader']}
        activateLabel="apply"
        initialSelectedId={session.selected.settings}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: 'a', label: 'watch port', onPress: addPort },
          { key: 'e', label: 'edit file', onPress: onEditConfig },
          { key: 'X', label: 'clear all', onPress: () => setClearing(true) },
        ]}
        onActivate={(item) => apply(item.value)}
        onSelectionChange={(item) => {
          setCurrent(item?.value);
          session.selected.settings = item?.id;
        }}
        renderDetail={(item) => (
          <Box flexDirection="column">
            <ClearButton onPress={() => setClearing(true)} />
            {item?.value ? detail(item.value) : null}
          </Box>
        )}
      />
    </Box>
  );
};

export default SettingsView;

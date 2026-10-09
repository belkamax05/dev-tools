import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ChipRow from '@/dev-tools/ui/components/ChipRow';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { splitWords } from '../../../../../devi/src/core/resolve';
import { SHOW_IDS, type ShowId } from '../../../config/settings';
import type { CommandSource, ProjiCommand } from '../../../core/project';
import type { Session, Tone } from '../../types';

export interface CommandsViewProps {
  commands: ProjiCommand[];
  /** What a command line starts with on screen — `dfs fe`, `proji`. */
  prefix: string;
  session: Session;
  notify: (text: string, tone?: Tone) => void;
  /** Run `command` (found at `path`) with `args`; the dashboard hands the terminal over. */
  onRun: (command: ProjiCommand, path: string[], args: string[]) => void;
  onStateChange: () => void;
  onCaptureInput: (captured: boolean) => void;
}

const SHOW_LABELS: Record<ShowId, string> = {
  all: 'All',
  override: 'Commands',
  alias: 'Aliases',
  script: 'Scripts',
};

const SECTION_LABELS: Record<CommandSource, string> = {
  override: 'Commands',
  alias: 'Aliases · proji.config.ts',
  script: 'Scripts · package.json',
};

const SOURCE_NOTES: Record<CommandSource, string> = {
  override: 'A command of this project, defined in code by the tool that opened proji.',
  alias: 'An alias from proji.config.ts. Extra arguments are appended to it.',
  script: "A package.json script, run through the project's package manager.",
};

/** The commands of the group `path` points into; the top level for an empty path. */
const levelAt = (commands: ProjiCommand[], path: string[]) => {
  let level = commands;
  for (const name of path) {
    const group = level.find((command) => command.name === name);
    if (!group?.children) return { level: commands, path: [] };
    level = group.children;
  }
  return { level, path };
};

const matches = (command: ProjiCommand, filter: string) => {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return (
    command.name.toLowerCase().includes(needle) ||
    (command.description ?? '').toLowerCase().includes(needle)
  );
};

/**
 * The project's commands: the tool's own, then the aliases, then the package.json scripts, each
 * under its heading. Enter runs a command (the terminal is lent to it, then proji comes back) or
 * opens a group; `a` asks for arguments first.
 */
export const CommandsView = ({
  commands,
  prefix,
  session,
  notify,
  onRun,
  onStateChange,
  onCaptureInput,
}: CommandsViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const resolved = levelAt(commands, session.path);
  const [path, setPath] = useState(resolved.path);
  const [filter, setFilter] = useState(session.filter);
  const [show, setShow] = useState<ShowId>(session.show);
  const [current, setCurrent] = useState<ProjiCommand | undefined>(undefined);

  const { level } = levelAt(commands, path);
  const placeKey = path.join(' ') || '.';

  const changePath = (next: string[]) => {
    setPath(next);
    session.path = next;
  };

  const changeFilter = (value: string) => {
    setFilter(value);
    session.filter = value;
  };

  const changeShow = (next: ShowId) => {
    setShow(next);
    session.show = next;
    onStateChange();
  };

  const visible = level.filter(
    (command) =>
      !command.hidden && (show === 'all' || command.source === show) && matches(command, filter),
  );

  //? Headings only where they separate something: the top level with every kind showing
  const sections: CommandSource[] = ['override', 'alias', 'script'];
  const items: PickItem<ProjiCommand>[] = sections.flatMap((source) => {
    const rows = visible.filter((command) => command.source === source);
    if (!rows.length) return [];
    const heading =
      show === 'all' && path.length === 0
        ? [{ id: `header-${source}`, label: SECTION_LABELS[source], isHeader: true }]
        : [];
    return [
      ...heading,
      ...rows.map((command) => ({
        id: `${source}:${command.name}`,
        label: command.children ? `${command.name} ▸` : command.name,
        hint: command.children ? `${command.children.length} inside` : command.description,
        value: command,
      })),
    ];
  });

  const open = (command: ProjiCommand | undefined) => {
    if (!command) return;
    if (command.children && !command.run) {
      changePath([...path, command.name]);
      changeFilter('');
      return;
    }
    onRun(command, [...path, command.name], []);
  };

  const askArgs = (command: ProjiCommand | undefined) => {
    if (!command?.run && !command?.argv) {
      notify('Pick a command to give arguments to', 'warn');
      return;
    }
    prompt.ask(`Arguments for ${[prefix, ...path, command.name].join(' ')}:`, (value) =>
      onRun(command, [...path, command.name], splitWords(value.trim())),
    );
  };

  const askFilter = () =>
    prompt.ask('Filter (name or description):', (value) => changeFilter(value.trim()), {
      initial: filter,
    });

  const goUp = () => {
    changePath(path.slice(0, -1));
    changeFilter('');
  };

  useInput(
    (input, key) => {
      if (input === 'a') askArgs(current);
      else if (input === '/') askFilter();
      else if (input === 'f')
        changeShow(SHOW_IDS[(SHOW_IDS.indexOf(show) + 1) % SHOW_IDS.length] ?? 'all');
      else if (key.escape && filter) changeFilter('');
      else if ((key.escape || key.backspace) && path.length) goUp();
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (command: ProjiCommand): ToolbarAction[] => {
    const isGroup = Boolean(command.children);
    return [
      ...(command.run || command.argv
        ? [
            {
              hotkey: 'Enter',
              label: 'Run',
              onPress: () => onRun(command, [...path, command.name], []),
              tone: 'primary' as const,
            },
            { hotkey: 'a', label: 'Run with args…', onPress: () => askArgs(command) },
          ]
        : []),
      ...(isGroup
        ? [
            {
              hotkey: command.run ? '→' : 'Enter',
              label: 'Open',
              onPress: () => {
                changePath([...path, command.name]);
                changeFilter('');
              },
              tone: command.run ? ('normal' as const) : ('primary' as const),
            },
          ]
        : []),
    ];
  };

  const hints: Hint[] = [
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
    ...(filter ? [{ key: 'Esc', label: 'clear', onPress: () => changeFilter('') }] : []),
    ...(path.length && !filter ? [{ key: 'Esc', label: 'up', onPress: goUp }] : []),
  ];

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      <Text color={colors.text}>{[prefix, ...path].join(' ')}</Text>
      {` · ${visible.length} of ${level.filter((command) => !command.hidden).length}`}
      {filter ? ` · matching "${filter}"` : ''}
      {path.length ? ' · Esc to go up' : ''}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <Box flexShrink={0}>
        <ChipRow
          label="show"
          hotkey="f"
          chips={SHOW_IDS.map((id) => ({ id, label: SHOW_LABELS[id], isOn: id === show }))}
          onToggle={(id) => changeShow(id as ShowId)}
        />
      </Box>
      <ListDetail
        key={`${placeKey}|${show}|${filter}`}
        title={path.length ? path.join(' › ') : 'Commands'}
        items={items}
        emptyText={filter ? `Nothing matches "${filter}".` : 'Nothing to run here.'}
        detailTitle="Command"
        reservedChrome={['viewHeader', 'chipRow']}
        activateLabel="run"
        initialSelectedId={session.selected[placeKey]}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => open(item.value)}
        onSelectionChange={(item) => {
          setCurrent(item?.value);
          session.selected[placeKey] = item?.id;
        }}
        renderDetail={(item) => {
          const command = item?.value;
          if (!command) return null;
          const line = command.argv?.([]).join(' ');
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(command)} />
              <Text color={colors.text} bold>
                {[prefix, ...path, command.name].join(' ')}
                {command.args ? <Text color={colors.muted}>{` ${command.args}`}</Text> : null}
              </Text>
              {command.description && command.source === 'script' ? (
                //? The list cuts a long script short with `…`; here it is whole
                <Box marginTop={1} flexDirection="column">
                  <Text color={colors.muted}>package.json</Text>
                  <Text color={colors.text} wrap="wrap">
                    {command.description}
                  </Text>
                </Box>
              ) : command.description ? (
                <Text color={colors.text} wrap="wrap">
                  {command.description}
                </Text>
              ) : null}
              {line ? (
                <Box marginTop={1} flexDirection="column">
                  <Text color={colors.muted}>Runs</Text>
                  <Text color={colors.accent} wrap="wrap">
                    {line}
                  </Text>
                </Box>
              ) : null}
              {command.children ? (
                <Box marginTop={1} flexDirection="column">
                  <Text color={colors.muted}>Inside</Text>
                  <Text color={colors.text} wrap="wrap">
                    {command.children.map((child) => child.name).join(' · ')}
                  </Text>
                </Box>
              ) : null}
              <Box marginTop={1}>
                <Text color={colors.muted} wrap="wrap">
                  {SOURCE_NOTES[command.source]}
                </Text>
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default CommandsView;

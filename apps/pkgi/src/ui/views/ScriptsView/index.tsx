import { Text, useInput } from 'ink';
import { type ReactNode, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { runScriptCommand, shellQuote } from '../../../core/manifest';
import { readScripts, type Script, splitArgs } from '../../../core/scripts';
import type { ViewProps } from '../../types';

/**
 * The command as a row's hint, cut short: a long one would otherwise squeeze the script's own
 * name off the row. The whole command is in the detail panel.
 */
const PREVIEW_LENGTH = 32;
const preview = (command: string) =>
  command.length > PREVIEW_LENGTH ? `${command.slice(0, PREVIEW_LENGTH - 1)}…` : command;

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

/**
 * The folder's `package.json` scripts, to run with its package manager — `pkgi run` with no
 * script opens here. A script runs on the real terminal, like every command pkgi hands off: its
 * output and prompts are its own, Ctrl+C stops it, and Enter comes back to the list.
 *
 * Scripts to run by name come first; lifecycle scripts and `pre`/`post` hooks, which the manager
 * runs on its own, are listed after them — runnable still, for when one needs running by hand.
 */
export const ScriptsView = ({
  dir,
  manager,
  session,
  notify,
  onCaptureInput,
  runCommands,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [filter, setFilter] = useState(session.scriptFilter ?? '');
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.scripts);

  const { data, isLoading } = useLoader(() => readScripts(dir), [dir, refreshKey]);
  const scripts = data?.scripts ?? [];
  const needle = filter.toLowerCase();
  const visible = scripts.filter(
    (script) =>
      !needle ||
      script.name.toLowerCase().includes(needle) ||
      script.command.toLowerCase().includes(needle),
  );
  const current = visible.find((script) => script.name === currentId);

  const groups: [string, Script[]][] = [
    ['Scripts', visible.filter((script) => script.kind === 'script')],
    ['Hooks & lifecycle', visible.filter((script) => script.kind === 'hook')],
  ];
  const items: PickItem<Script>[] = groups.flatMap(([title, group]) =>
    group.length
      ? [
          { id: `header-${title}`, label: `${title} (${group.length})`, isHeader: true },
          ...group.map((script) => ({
            id: script.name,
            label: script.name,
            hint: preview(script.command),
            hintColor: script.kind === 'hook' ? colors.muted : undefined,
            value: script,
          })),
        ]
      : [],
  );

  const run = (script: Script | undefined, args: string[] = []) => {
    if (!script) return;
    session.selected.scripts = script.name;
    runCommands(
      [runScriptCommand(manager.name, script.name, args)],
      `${script.name}${args.length ? ` ${shellQuote(args)}` : ''}`,
    );
  };

  const runWithArgs = (script: Script | undefined) => {
    if (!script) return;
    prompt.ask(`Arguments for ${script.name}:`, (value) => {
      if (value.trim()) run(script, splitArgs(value));
      else notify('No arguments given — Enter runs it without any');
    });
  };

  const askFilter = () =>
    prompt.ask(
      'Filter (name or command):',
      (value) => {
        setFilter(value.trim());
        session.scriptFilter = value.trim();
      },
      { initial: filter },
    );

  useInput(
    (input, key) => {
      if (input === 'a') runWithArgs(current);
      else if (input === '/') askFilter();
      else if (key.escape && filter) {
        setFilter('');
        session.scriptFilter = '';
      }
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (script: Script): ToolbarAction[] => [
    { hotkey: 'Enter', label: 'Run', onPress: () => run(script), tone: 'primary' as const },
    { hotkey: 'a', label: 'Run with args…', onPress: () => runWithArgs(script) },
  ];

  const hints: Hint[] = [
    { key: 'a', label: 'run with args', onPress: () => runWithArgs(current) },
    { key: '/', label: filter ? `filter: ${filter}` : 'filter', onPress: askFilter },
  ];

  if (data && !data.exists) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={colors.warn}>{`No package.json in ${dir}`}</Text>
      </Box>
    );
  }

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {data?.error
        ? `package.json could not be read: ${data.error}`
        : `${scripts.filter((script) => script.kind === 'script').length} scripts · run with ${
            manager.name
          }${filter ? ` · "${filter}"` : ''}`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={`${filter}|${visible.length}`}
        title={`Scripts (${visible.length})`}
        items={items}
        emptyText={
          isLoading ? 'Reading package.json…' : filter ? 'Nothing matches.' : 'No scripts.'
        }
        detailTitle={current ? current.name : 'Script'}
        reservedChrome={['viewHeader']}
        activateLabel="run"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => run(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.scripts = item?.id;
        }}
        renderDetail={(item) => {
          const script = item?.value;
          if (!script) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(script)} />
              <Box marginTop={1} flexDirection="column">
                <Field label="Command">
                  <Text color={colors.text} wrap="wrap">
                    {script.command}
                  </Text>
                </Field>
                <Field label="Runs as">
                  <Text color={colors.muted} wrap="truncate">
                    {shellQuote(runScriptCommand(manager.name, script.name))}
                  </Text>
                </Field>
                {script.pre && (
                  <Field label="Before">
                    <Text color={colors.muted} wrap="truncate">
                      {`${script.pre}: ${scripts.find((other) => other.name === script.pre)?.command ?? ''}`}
                    </Text>
                  </Field>
                )}
                {script.post && (
                  <Field label="After">
                    <Text color={colors.muted} wrap="truncate">
                      {`${script.post}: ${scripts.find((other) => other.name === script.post)?.command ?? ''}`}
                    </Text>
                  </Field>
                )}
              </Box>
              {script.kind === 'hook' && (
                <Box marginTop={1}>
                  <Text color={colors.warn} wrap="wrap">
                    The package manager runs this one on its own — at install, pack or publish, or
                    around the script it is named after.
                  </Text>
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default ScriptsView;

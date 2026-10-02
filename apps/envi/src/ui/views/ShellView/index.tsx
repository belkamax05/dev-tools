import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useMemo, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import { isSecretKey, maskValue, touchStamp, withVar } from '../../../config/settings';
import { setInEnvFile } from '../../../core/envFile';
import { quoteValue } from '../../../core/parse';
import { matchesSearch } from '../../../core/search';
import { launchEnv, readApplied } from '../../../core/shell';
import type { ViewProps } from '../../App';
import useSearch from '../../useSearch';
import ValueBlock, { isPathList } from '../../ValueBlock';

interface ShellVar {
  key: string;
  value: string;
  secret: boolean;
  /** The hook exported it, rather than the shell's own rc or a parent process. */
  fromEnvi: boolean;
}

/** One line of a value for a list row: newlines shown, long values cut by the pane. */
export const preview = (value: string, secret: boolean, reveal: boolean) =>
  secret && !reveal ? maskValue(value) : value.replace(/\n/g, '⏎');

/**
 * The shell's exported variables — what envi inherited from the shell it was started in, so the
 * exact environment a command typed there gets. Unexported shell variables never reach a child
 * process and so are not here (that is also why they are no use to a program).
 *
 * Searched by name and value together; a row the hook set is marked, and any of them can be
 * pinned into this folder's `.env.user` or into your vars.
 */
export const ShellView = ({
  config,
  cwd,
  session,
  reveal,
  notify,
  reload,
  onConfigChange,
  onCaptureInput,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const { search, open, clear, hints: searchHints } = useSearch(session, 'shell', prompt);

  const all = useMemo<ShellVar[]>(() => {
    const env = launchEnv();
    const applied = readApplied(env);
    return Object.entries(env)
      .map(([key, value]) => ({
        key,
        value,
        secret: isSecretKey(key, config.maskPatterns),
        fromEnvi: key in applied,
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [config.maskPatterns]);

  const rows = all.filter((entry) => matchesSearch(entry.key, entry.value, search));
  const [currentId, setCurrentId] = useState(session.selected.shell);
  const current = rows.find((entry) => entry.key === currentId) ?? rows[0];

  const copy = (entry: ShellVar | undefined, withKey: boolean) => {
    if (!entry) return;
    copyToClipboard(withKey ? `${entry.key}=${quoteValue(entry.value)}` : entry.value);
    notify(`Copied ${withKey ? `${entry.key}=…` : `the value of ${entry.key}`}`, 'ok');
  };

  const pinToFile = (entry: ShellVar | undefined) => {
    if (!entry) return;
    const path = join(cwd, '.env.user');
    prompt.confirm(`Write ${entry.key} into ${path}?`, () => {
      setInEnvFile(path, entry.key, entry.value)
        .then(touchStamp)
        .then(() => {
          notify(`${entry.key} → .env.user`, 'ok');
          reload();
        })
        .catch((error: Error) => notify(error.message, 'error'));
    });
  };

  const pinToVars = (entry: ShellVar | undefined) => {
    if (!entry) return;
    prompt.confirm(`Keep ${entry.key} in your vars (every folder)?`, () => {
      onConfigChange({
        ...config,
        vars: withVar(config.vars, entry.key, entry.value),
      });
      notify(`${entry.key} is one of your vars now`, 'ok');
    });
  };

  useInput(
    (input, key) => {
      if (input === 'c') copy(current, false);
      else if (input === 'C') copy(current, true);
      else if (input === 's') pinToFile(current);
      else if (input === 'g') pinToVars(current);
      else if (input === '/') open();
      else if (key.escape && search) clear();
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (entry: ShellVar): ToolbarAction[] => [
    {
      hotkey: 'c',
      label: 'Copy value',
      onPress: () => copy(entry, false),
      tone: 'primary',
    },
    { hotkey: 'C', label: 'Copy KEY=value', onPress: () => copy(entry, true) },
    { hotkey: 's', label: 'To .env.user', onPress: () => pinToFile(entry) },
    { hotkey: 'g', label: 'To your vars', onPress: () => pinToVars(entry) },
  ];

  const items: PickItem<ShellVar>[] = rows.map((entry) => ({
    id: entry.key,
    label: `${entry.fromEnvi ? '◆' : ' '} ${entry.key}`,
    hint: preview(entry.value, entry.secret, reveal),
    hintColor: entry.secret && !reveal ? colors.warn : undefined,
    value: entry,
  }));

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {search
        ? `${rows.length} of ${all.length} match "${search}" in names or values`
        : `${all.length} exported · ◆ ${all.filter((entry) => entry.fromEnvi).length} set by the envi hook`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        //? Remount when the rows change, restoring the cursor by id
        key={`${search}|${rows.length}`}
        title={`Shell (${rows.length})`}
        items={items}
        emptyText={search ? 'No name or value matches — Esc clears the search.' : 'No variables.'}
        detailTitle={current?.key ?? 'Variable'}
        reservedChrome={['viewHeader']}
        activateLabel="copy"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={searchHints}
        onActivate={(item) => copy(item.value, false)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.shell = item?.id;
        }}
        renderDetail={(item) => {
          const entry = item?.value;
          if (!entry) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(entry)} />
              <Text color={colors.muted} wrap="truncate">
                {[
                  `${entry.value.length} chars`,
                  isPathList(entry.key, entry.value)
                    ? `${entry.value.split(':').length} entries`
                    : '',
                  entry.secret ? 'secret' : '',
                  entry.fromEnvi ? 'set by the envi hook' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Box marginTop={1}>
                <ValueBlock
                  name={entry.key}
                  value={entry.value}
                  secret={entry.secret}
                  reveal={reveal}
                />
              </Box>
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default ShellView;

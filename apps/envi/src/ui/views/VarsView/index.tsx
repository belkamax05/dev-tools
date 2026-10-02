import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import { isSecretKey, withoutVar, withVar } from '../../../config/settings';
import { isValidKey, parseAssignment } from '../../../core/parse';
import { matchesSearch } from '../../../core/search';
import type { ViewProps } from '../../App';
import useSearch from '../../useSearch';
import ValueBlock from '../../ValueBlock';
import { preview } from '../ShellView';

type Row = { kind: 'var'; key: string; value: string } | { kind: 'add' };

/**
 * Your own variables — `vars` in envi's config. They sit under every folder's files and configs
 * and are applied in every shell the hook runs in, so this is where a token or a tool's setting
 * that is yours rather than a project's belongs.
 */
export const VarsView = ({
  resolution,
  config,
  session,
  reveal,
  notify,
  onConfigChange,
  onCaptureInput,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const { search, open, clear, hints: searchHints } = useSearch(session, 'vars', prompt);
  const [currentId, setCurrentId] = useState(session.selected.vars);

  const entries = Object.entries(config.vars)
    .filter(([key, value]) => matchesSearch(key, value, search))
    .sort(([a], [b]) => a.localeCompare(b));

  const items: PickItem<Row>[] = [
    ...entries.map(([key, value]) => ({
      id: `var:${key}`,
      label: key,
      hint: preview(value, isSecretKey(key, config.maskPatterns), reveal),
      value: { kind: 'var' as const, key, value },
    })),
    { id: 'add', label: '+ Add a variable…', value: { kind: 'add' as const } },
  ];
  const current = items.find((item) => item.id === currentId)?.value ?? items[0]?.value;

  const add = () =>
    prompt.ask('KEY=value (yours, in every folder):', (text) => {
      const parsed = parseAssignment(text);
      if (!parsed) {
        notify(`"${text}" is not KEY=value`, 'error');
        return;
      }
      onConfigChange({
        ...config,
        vars: withVar(config.vars, parsed.key, parsed.value),
      });
      setCurrentId(`var:${parsed.key}`);
      notify(`${parsed.key} added`, 'ok');
    });

  const editValue = (key: string, value: string) =>
    prompt.ask(
      `${key} =`,
      (next) => onConfigChange({ ...config, vars: withVar(config.vars, key, next) }),
      {
        initial: value,
        secret: isSecretKey(key, config.maskPatterns) && !reveal,
      },
    );

  const rename = (key: string, value: string) =>
    prompt.ask(
      `Rename ${key} to:`,
      (next) => {
        const name = next.trim();
        if (!isValidKey(name)) {
          notify(`"${name}" is not a valid name`, 'error');
          return;
        }
        onConfigChange({
          ...config,
          vars: withVar(withoutVar(config.vars, key), name, value),
        });
        setCurrentId(`var:${name}`);
      },
      { initial: key },
    );

  const remove = (key: string) =>
    prompt.confirm(`Delete ${key} from your vars?`, () => {
      onConfigChange({ ...config, vars: withoutVar(config.vars, key) });
      notify(`${key} deleted`);
    });

  const copy = (value: string, key: string) => {
    copyToClipboard(value);
    notify(`Copied the value of ${key}`, 'ok');
  };

  useInput(
    (input, key) => {
      if (input === 'a') add();
      else if (input === '/') open();
      else if (key.escape && search) clear();
      else if (current?.kind === 'var') {
        if (input === 'n' || input === 'e') editValue(current.key, current.value);
        else if (input === 'R') rename(current.key, current.value);
        else if (input === 'x' || input === 'd') remove(current.key);
        else if (input === 'c') copy(current.value, current.key);
      }
    },
    { isActive: !prompt.isOpen },
  );

  const detail = (row: Row) => {
    if (row.kind === 'add') {
      return (
        <Text color={colors.muted} wrap="wrap">
          A variable that is yours rather than a project's — applied under every folder's .env
          files, so a project can still override it. Values may use $OTHER and ${'{OTHER:-default}'}
          .
        </Text>
      );
    }
    const resolved = resolution?.vars.find((entry) => entry.key === row.key);
    const fate = !resolved
      ? 'not applied'
      : resolved.source.kind !== 'user'
        ? `overridden by ${resolved.source.label}${resolved.source.line ? `:${resolved.source.line}` : ''} here`
        : resolved.status === 'kept'
          ? 'the shell exports its own value, which wins (override is off)'
          : resolved.status === 'same'
            ? 'applied — the shell already has this value'
            : 'applied here';
    return (
      <Box flexDirection="column">
        <Toolbar
          actions={[
            {
              hotkey: 'n',
              label: 'Edit value',
              onPress: () => editValue(row.key, row.value),
              tone: 'primary',
            },
            {
              hotkey: 'c',
              label: 'Copy',
              onPress: () => copy(row.value, row.key),
            },
            {
              hotkey: 'R',
              label: 'Rename',
              onPress: () => rename(row.key, row.value),
            },
            {
              hotkey: 'x',
              label: 'Delete',
              onPress: () => remove(row.key),
              tone: 'danger',
            },
          ]}
        />
        <Text
          color={
            resolved?.source.kind === 'user' && resolved.status !== 'kept' ? colors.ok : colors.warn
          }
          wrap="wrap"
        >
          {fate}
        </Text>
        <Box marginTop={1}>
          <ValueBlock
            name={row.key}
            value={row.value}
            secret={isSecretKey(row.key, config.maskPatterns)}
            reveal={reveal}
          />
        </Box>
      </Box>
    );
  };

  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {`${Object.keys(config.vars).length} of your own${search ? ` · ${entries.length} match "${search}"` : ''} · applied in every folder, under its files`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => item.id).join(',')}
        title={`Your vars (${entries.length})`}
        items={items}
        detailTitle={current?.kind === 'var' ? current.key : 'New variable'}
        reservedChrome={['viewHeader']}
        activateLabel="edit"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={[{ key: 'a', label: 'add', onPress: add }, ...searchHints]}
        onActivate={(item) =>
          item.value?.kind === 'var' ? editValue(item.value.key, item.value.value) : add()
        }
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.vars = item?.id;
        }}
        renderDetail={(item) => (item?.value ? detail(item.value) : null)}
      />
    </Box>
  );
};

export default VarsView;

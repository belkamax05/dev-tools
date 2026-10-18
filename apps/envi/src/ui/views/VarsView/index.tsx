import { homedir } from 'node:os';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import copyToClipboard from '@/dev-tools/utils/system/copyToClipboard';

import { configStore, isSecretKey, withoutVar, withVar } from '../../../config/settings';
import { isOpRef, OP_PREFIX } from '../../../core/onePassword';
import { isValidKey, parseAssignment } from '../../../core/parse';
import { matchesSearch } from '../../../core/search';
import type { ViewProps } from '../../App';
import useSearch from '../../useSearch';
import useSecretPreview from '../../useSecretPreview';
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
  onEdit,
}: ViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const { search, open, clear, hints: searchHints } = useSearch(session, 'vars', prompt);
  const [currentId, setCurrentId] = useState(session.selected.vars);
  const secrets = useSecretPreview();
  const settingsPath = configStore.path;
  const openSettings = () => onEdit(settingsPath);

  const entries = Object.entries(config.vars)
    .filter(([key, value]) => matchesSearch(key, value, search))
    .sort(([a], [b]) => a.localeCompare(b));

  const items: PickItem<Row>[] = [
    ...entries.map(([key, value]) => ({
      id: `var:${key}`,
      label: key,
      hint: preview(value, isSecretKey(key, config.maskPatterns), reveal || secrets.isRevealed(key)),
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
        secret: isSecretKey(key, config.maskPatterns) && !reveal && !isOpRef(value),
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

  /** The secret itself — a reference read from 1Password first — onto the clipboard. */
  const copySecret = (value: string, key: string) =>
    secrets
      .secretOf(value)
      .then((secret) => {
        copyToClipboard(secret);
        notify(`Copied ${key}'s secret${isOpRef(value) ? ' (read from 1Password)' : ''}`, 'ok');
      })
      .catch((error: Error) => notify(error.message, 'error'));

  const toggleReveal = (value: string, key: string) => {
    const shown = secrets.toggleReveal(key, value);
    notify(`${key} ${shown ? 'shown' : 'masked again'}`, 'info');
  };

  useInput(
    (input, key) => {
      if (input === 'a') add();
      else if (input === 'o') openSettings();
      else if (input === '/') open();
      else if (key.escape && search) clear();
      else if (current?.kind === 'var') {
        if (input === 'n' || input === 'e') editValue(current.key, current.value);
        else if (input === 'R') rename(current.key, current.value);
        else if (input === 'x' || input === 'd') remove(current.key);
        else if (input === 'c') copy(current.value, current.key);
        else if (input === 'C') copySecret(current.value, current.key);
        else if (input === 'u') toggleReveal(current.value, current.key);
        else if (input === 'p') secrets.preview(current.value);
      }
    },
    { isActive: !prompt.isOpen },
  );

  const actionsFor = (key: string, value: string): ToolbarAction[] => [
    {
      hotkey: 'n',
      label: 'Edit value',
      onPress: () => editValue(key, value),
      tone: 'primary',
    },
    ...(isOpRef(value)
      ? [{ hotkey: 'p', label: 'Preview secret', onPress: () => secrets.preview(value) }]
      : []),
    { hotkey: 'c', label: isOpRef(value) ? 'Copy reference' : 'Copy', onPress: () => copy(value, key) },
    ...(isOpRef(value) || isSecretKey(key, config.maskPatterns)
      ? [
          {
            hotkey: 'u',
            label: secrets.isRevealed(key) ? 'Hide' : 'Reveal',
            onPress: () => toggleReveal(value, key),
          },
          { hotkey: 'C', label: 'Copy secret', onPress: () => copySecret(value, key) },
        ]
      : []),
    { hotkey: 'R', label: 'Rename', onPress: () => rename(key, value) },
    { hotkey: 'x', label: 'Delete', onPress: () => remove(key), tone: 'danger' },
  ];

  const detail = (row: Row) => {
    if (row.kind === 'add') {
      return (
        <Text color={colors.muted} wrap="wrap">
          A variable that is yours rather than a project's — applied under every folder's .env
          files, so a project can still override it. Values may use $OTHER and ${'{OTHER:-default}'}
          . A value written as {OP_PREFIX}vault/item/field is read from 1Password (op) only when a
          command needs it.
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
        <Toolbar actions={actionsFor(row.key, row.value)} />
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
            reveal={reveal || secrets.isRevealed(row.key)}
            {...secrets.blockProps(row.value)}
          />
        </Box>
      </Box>
    );
  };

  //? Your vars live in envi's own config, not in any folder — the file is named, and opens on click
  const header = prompt.line ?? (
    <Box>
      <Box flexShrink={0}>
        <LinkRow
          label="saved in"
          labelWidth={9}
          value={settingsPath.replace(homedir(), '~')}
          onOpen={openSettings}
        />
      </Box>
      <Box flexShrink={1}>
        <Text color={colors.muted} wrap="truncate">
          {`  [o] · ${Object.keys(config.vars).length} of your own${search ? ` · ${entries.length} match "${search}"` : ''} · applied in every folder, under its files`}
        </Text>
      </Box>
    </Box>
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
        hints={[
          { key: 'a', label: 'add', onPress: add },
          { key: 'o', label: 'open file', onPress: openSettings },
          ...searchHints,
        ]}
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

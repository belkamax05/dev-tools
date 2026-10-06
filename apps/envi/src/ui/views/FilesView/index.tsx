import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  PROJECT_CONFIG_NAMES,
  PROJECT_CONFIG_TEMPLATE,
  type ProjectConfig,
} from '../../../config/project';
import { DEFAULT_FILES, isSecretKey, touchStamp } from '../../../config/settings';
import { setInEnvFile } from '../../../core/envFile';
import { parseAssignment } from '../../../core/parse';
import { disableFile, enableFile, type Layer } from '../../../core/resolve';
import type { ViewProps } from '../../App';
import { preview } from '../ShellView';

type Row =
  | { kind: 'file'; layer: Layer }
  | { kind: 'add' }
  | { kind: 'defaults' }
  | { kind: 'project'; project: ProjectConfig }
  | { kind: 'init' };

const STATE_GLYPH: Record<Layer['status'], string> = {
  loaded: '●',
  missing: '·',
  disabled: '○',
  error: '✗',
};

/**
 * The env files envi reads here, in the order it reads them, and the `env.config.ts` files that
 * add to them.
 *
 * Your own list (`.env`, `.env.user` to start with) can be added to, reordered and pruned; any
 * file — yours or one a workspace config lists — can be switched off and on again, which is
 * saved to your config. A file that does not exist yet is listed too: a missing `.env.user` is
 * the normal case, and [n] creates it with its first variable.
 */
export const FilesView = ({
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
  const [currentId, setCurrentId] = useState(session.selected.files);

  const files = (resolution?.layers ?? []).filter((layer) => layer.kind === 'file');
  const projects = resolution?.projects ?? [];
  const hasLocalConfig = PROJECT_CONFIG_NAMES.some((name) => existsSync(join(cwd, name)));
  const missingDefaults = DEFAULT_FILES.filter((name) => !config.files.includes(name));

  const fileHint = (layer: Layer) =>
    layer.status === 'loaded'
      ? `${layer.entries.length} vars${layer.errors.length ? ` · ${layer.errors.length} bad lines` : ''}`
      : layer.status === 'disabled'
        ? layer.disabledBy === 'config'
          ? 'off'
          : 'off in env.config.ts'
        : layer.status === 'missing'
          ? 'not created'
          : 'unreadable';

  const items: PickItem<Row>[] = [
    {
      id: 'header-files',
      label: 'Env files, in order — later wins',
      isHeader: true,
    },
    ...files.map((layer) => ({
      id: layer.id,
      label: `${STATE_GLYPH[layer.status]} ${layer.label}${layer.listedBy === 'config' ? '' : '  ⚙'}`,
      hint: fileHint(layer),
      hintColor:
        layer.status === 'loaded' ? colors.ok : layer.status === 'error' ? colors.error : undefined,
      value: { kind: 'file' as const, layer },
    })),
    { id: 'add', label: '+ Add a file…', value: { kind: 'add' as const } },
    ...(missingDefaults.length
      ? [
          {
            id: 'defaults',
            label: `↺ Add back ${missingDefaults.join(', ')}`,
            value: { kind: 'defaults' as const },
          },
        ]
      : []),
    {
      id: 'header-projects',
      label: 'Workspace configs (env.config.ts)',
      isHeader: true,
    },
    ...projects.map((project) => ({
      id: `project:${project.path}`,
      label: `${project.error ? '✗' : '⚙'} ${project.path.replace(`${resolution?.root ?? ''}/`, '')}`,
      hint: project.error
        ? 'error'
        : `${Object.keys(project.vars).length} vars · ${project.files.length} files`,
      hintColor: project.error ? colors.error : undefined,
      value: { kind: 'project' as const, project },
    })),
    ...(hasLocalConfig
      ? []
      : [
          {
            id: 'init',
            label: '+ Create env.config.ts here',
            value: { kind: 'init' as const },
          },
        ]),
  ];
  const current =
    items.find((item) => item.id === currentId && item.value)?.value ??
    items.find((item) => item.value)?.value;

  const changed = (message: string) => {
    notify(message, 'ok');
    touchStamp().then(reload);
  };

  const toggle = (layer: Layer) => {
    if (layer.status === 'disabled') {
      if (layer.disabledBy && layer.disabledBy !== 'config') {
        notify(`${layer.label} is switched off by ${layer.disabledBy} — [o] opens it`, 'warn');
        return;
      }
      onConfigChange(enableFile(config, layer, cwd));
      notify(`Reading ${layer.label} again`, 'ok');
    } else {
      onConfigChange(disableFile(config, layer));
      notify(
        layer.listedBy === 'config'
          ? `${layer.written} is off — in every folder`
          : `${layer.label} is off`,
      );
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

  const removeFile = (layer: Layer) => {
    if (layer.listedBy !== 'config' || !layer.written) {
      notify(
        `${layer.label} comes from ${layer.listedBy} — switch it off with [space] instead`,
        'warn',
      );
      return;
    }
    const written = layer.written;
    prompt.confirm(`Stop listing ${written}? (the file itself stays)`, () => {
      onConfigChange({
        ...config,
        files: config.files.filter((entry) => entry !== written),
      });
      notify(`${written} is out of your list`);
    });
  };

  const move = (layer: Layer, by: -1 | 1) => {
    const at = layer.written ? config.files.indexOf(layer.written) : -1;
    if (layer.listedBy !== 'config' || at < 0) return;
    const to = at + by;
    if (to < 0 || to >= config.files.length) return;
    const next = [...config.files];
    [next[at], next[to]] = [next[to] as string, next[at] as string];
    onConfigChange({ ...config, files: next });
  };

  const addVar = (layer: Layer) =>
    prompt.ask(`KEY=value into ${layer.label}:`, (text) => {
      const parsed = parseAssignment(text);
      if (!parsed || !layer.path) {
        notify(`"${text}" is not KEY=value`, 'error');
        return;
      }
      setInEnvFile(layer.path, parsed.key, parsed.value)
        .then(() => changed(`${parsed.key} set in ${layer.label}`))
        .catch((error: Error) => notify(error.message, 'error'));
    });

  const init = () => {
    const path = join(cwd, 'env.config.ts');
    Bun.write(path, PROJECT_CONFIG_TEMPLATE)
      .then(() => onEdit(path))
      .catch((error: Error) => notify(error.message, 'error'));
  };

  const activate = (row: Row | undefined) => {
    if (!row) return;
    if (row.kind === 'file') toggle(row.layer);
    else if (row.kind === 'add') addFile();
    else if (row.kind === 'defaults')
      onConfigChange({
        ...config,
        files: [...missingDefaults, ...config.files],
      });
    else if (row.kind === 'project') onEdit(row.project.path);
    else init();
  };

  useInput(
    (input) => {
      if (input === ' ') activate(current);
      else if (input === 'a') addFile();
      else if (current?.kind === 'file') {
        const { layer } = current;
        if (input === 'e' || input === 'o') layer.path && onEdit(layer.path);
        else if (input === 'n') addVar(layer);
        else if (input === 'x') removeFile(layer);
        else if (input === '[') move(layer, -1);
        else if (input === ']') move(layer, 1);
      } else if (current?.kind === 'project' && (input === 'e' || input === 'o'))
        onEdit(current.project.path);
    },
    { isActive: !prompt.isOpen },
  );

  const fileActions = (layer: Layer): ToolbarAction[] => {
    const mine = layer.listedBy === 'config';
    return [
      {
        hotkey: 'space',
        label: layer.status === 'disabled' ? 'Switch on' : 'Switch off',
        onPress: () => toggle(layer),
        tone: 'primary',
      },
      {
        hotkey: 'e',
        label: layer.status === 'missing' ? 'Create' : 'Edit',
        onPress: () => layer.path && onEdit(layer.path),
      },
      { hotkey: 'n', label: 'Add var', onPress: () => addVar(layer) },
      ...(mine
        ? [
            { hotkey: '[', label: 'Earlier', onPress: () => move(layer, -1) },
            { hotkey: ']', label: 'Later', onPress: () => move(layer, 1) },
            {
              hotkey: 'x',
              label: 'Unlist',
              onPress: () => removeFile(layer),
              tone: 'danger' as const,
            },
          ]
        : []),
    ];
  };

  const renderFile = (layer: Layer) => (
    <Box flexDirection="column">
      <Toolbar actions={fileActions(layer)} />
      <Text color={colors.muted} wrap="truncate-middle">
        {layer.path}
      </Text>
      <Text color={colors.muted} wrap="wrap">
        {[
          layer.listedBy === 'config' ? 'in your list' : `listed by ${layer.listedBy}`,
          layer.status === 'disabled'
            ? `switched off${layer.disabledBy === 'config' ? ' in your config' : ` by ${layer.disabledBy}`}`
            : '',
          layer.status === 'missing' ? 'does not exist yet — [e] or [n] creates it' : '',
          layer.error ?? '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {layer.errors.map((error) => (
        <Text key={error.line} color={colors.error} wrap="truncate">
          {`line ${error.line}: ${error.message}`}
        </Text>
      ))}
      {layer.entries.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {layer.entries.map((entry) => {
            const winner = resolution?.vars.find((candidate) => candidate.key === entry.key);
            const lost = winner && winner.source.layerId !== layer.id;
            return (
              <Text
                key={`${entry.key}:${entry.line ?? ''}`}
                color={lost ? colors.muted : colors.text}
                wrap="truncate"
              >
                {`${entry.key}=${preview(entry.value, isSecretKey(entry.key, config.maskPatterns), reveal)}${lost ? `   ← ${winner.source.label} wins` : ''}`}
              </Text>
            );
          })}
        </Box>
      )}
    </Box>
  );

  const detail = (row: Row) => {
    switch (row.kind) {
      case 'file':
        return renderFile(row.layer);
      case 'add':
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
      case 'project': {
        const { project } = row;
        return (
          <Box flexDirection="column">
            <Toolbar
              actions={[
                {
                  hotkey: 'e',
                  label: 'Edit',
                  onPress: () => onEdit(project.path),
                  tone: 'primary',
                },
              ]}
            />
            <Text color={colors.muted} wrap="truncate-middle">
              {project.path}
            </Text>
            {project.error ? (
              <Text color={colors.error} wrap="wrap">
                {project.error}
              </Text>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                {project.files.length > 0 && (
                  <Text color={colors.text}>{`files: ${project.files.join(', ')}`}</Text>
                )}
                {project.disable.length > 0 && (
                  <Text color={colors.text}>{`disable: ${project.disable.join(', ')}`}</Text>
                )}
                {project.required.length > 0 && (
                  <Text color={colors.text}>{`required: ${project.required.join(', ')}`}</Text>
                )}
                {project.override !== undefined && (
                  <Text color={colors.text}>{`override: ${project.override}`}</Text>
                )}
                {Object.entries(project.vars).map(([key, value]) => (
                  <Text key={key} color={colors.text} wrap="truncate">
                    {`${key}=${preview(value, isSecretKey(key, config.maskPatterns), reveal)}`}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      }
      case 'init':
        return (
          <Text color={colors.muted} wrap="wrap">
            Write a commented env.config.ts template here and open it. It applies to this folder and
            everything below it, after the git root's own; its vars win over every .env file.
          </Text>
        );
    }
  };

  const loaded = files.filter((layer) => layer.status === 'loaded').length;
  const header = prompt.line ?? (
    <Text color={colors.muted} wrap="truncate">
      {`${loaded} of ${files.length} files read · ${projects.length} env.config.ts · ⚙ = listed by a workspace config`}
    </Text>
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        key={items.map((item) => `${item.id}${item.hint ?? ''}`).join(',')}
        title={`Files (${files.length})`}
        items={items}
        emptyText={isLoading ? 'Reading the layers…' : 'No files.'}
        detailTitle={
          current?.kind === 'file'
            ? current.layer.label
            : current?.kind === 'project'
              ? 'env.config.ts'
              : 'Files'
        }
        reservedChrome={['viewHeader']}
        activateLabel="toggle"
        activateOnClick={false}
        initialSelectedId={currentId}
        isInputActive={!prompt.isOpen}
        hints={[{ key: 'a', label: 'add file', onPress: addFile }]}
        onActivate={(item) => activate(item.value)}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.files = item?.id;
        }}
        renderDetail={(item) => (item?.value ? detail(item.value) : null)}
      />
    </Box>
  );
};

export default FilesView;

import { homedir } from 'node:os';
import { relative } from 'node:path';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  buildComparisons,
  ENV_FILE,
  getDiffFields,
  getRequiredTokens,
  listServerTools,
  type McpServerComparison,
  type McpServerStatus,
  type McpToolsResult,
  type RequiredToken,
  readEnvFile,
  readSourceMcp,
  readTargetMcp,
  setEnvValue,
  writeServers,
} from '../../../core/mcp';
import revealPath from '../../../utils/revealPath';
import type { ViewProps } from '../../types';
import useLoader from '../../useLoader';
import usePrompt from '../../usePrompt';

type Row =
  | { kind: 'server'; comparison: McpServerComparison }
  | { kind: 'token'; token: RequiredToken };

const STATUS_LABEL: Record<McpServerStatus, string> = {
  synced: 'synced',
  diff: 'differs',
  'missing-in-target': 'not in IDE',
  'target-only': 'IDE only',
};

/** `~/…` for anything under the home directory, repo-relative for anything in the repo. */
const displayPath = (path: string, root: string) => {
  if (path.startsWith(`${root}/`)) return relative(root, path);
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~/${relative(home, path)}` : path;
};

const mask = (value: string) => (value.length <= 4 ? '••••' : `••••${value.slice(-4)}`);

/**
 * The repository's reference MCP servers against the selected IDE's config —
 * the web version's IDE MCP page.
 *
 * Every action writes one of the two JSON files straight away, as the web
 * version's did; there is no pending state to save or lose. The env tokens
 * servers need are listed under the servers, set in `.env.user` from here.
 */
export const McpView = ({
  root,
  ide,
  session,
  notify,
  onCaptureInput,
  handoff,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.mcp);
  const [tools, setTools] = useState<Record<string, McpToolsResult | 'loading'>>({});

  const { data, error, reload } = useLoader(
    () => ({
      source: readSourceMcp(root),
      target: readTargetMcp(root, ide),
      env: readEnvFile(root),
    }),
    [root, ide.id, refreshKey],
  );

  const source = data?.source;
  const target = data?.target;
  const comparisons = source && target ? buildComparisons(source.servers, target.servers) : [];
  const tokens = source ? getRequiredTokens(source) : [];
  const tokenValue = (key: string) => data?.env[key] ?? process.env[key];

  const items: PickItem<Row>[] = [
    {
      id: 'header-servers',
      label: `Servers (${comparisons.length})`,
      isHeader: true,
    },
    ...comparisons.map((comparison): PickItem<Row> => {
      const cached = tools[comparison.name];
      const toolsHint =
        cached === 'loading'
          ? ' · …'
          : cached?.error
            ? ' · tools ✗'
            : cached
              ? ` · ${cached.tools.length} tools`
              : '';
      return {
        id: `server:${comparison.name}`,
        label: comparison.name,
        hint: `${STATUS_LABEL[comparison.status]}${comparison.targetEntry?.disabled ? ' · off' : ''}${toolsHint}`,
        value: { kind: 'server', comparison },
      };
    }),
    ...(tokens.length > 0
      ? [
          {
            id: 'header-tokens',
            label: `Env tokens (${ENV_FILE})`,
            isHeader: true,
          },
          ...tokens.map(
            (token): PickItem<Row> => ({
              id: `token:${token.key}`,
              label: token.key,
              hint: tokenValue(token.key) ? 'set' : 'missing',
              value: { kind: 'token', token },
            }),
          ),
        ]
      : []),
  ];
  const current = items.find((item) => item.id === currentId)?.value;

  const save = (which: 'source' | 'target', servers: Record<string, unknown>, message: string) => {
    const file = which === 'source' ? source : target;
    if (!file) return;
    try {
      writeServers(file, servers as never);
      notify(message, 'ok');
    } catch (cause) {
      notify((cause as Error).message, 'error');
    }
    reload();
  };

  const push = (c: McpServerComparison) => {
    if (!target || !c.sourceEntry)
      return notify(`${c.name} is not in the reference config`, 'warn');
    const run = () =>
      save(
        'target',
        {
          ...target.servers,
          [c.name]: { ...c.sourceEntry, disabled: c.targetEntry?.disabled },
        },
        `Copied ${c.name} to ${ide.name}`,
      );
    if (c.status === 'diff')
      prompt.confirm(`Overwrite ${c.name} in ${ide.name}'s config with the reference?`, run);
    else if (c.status === 'synced') notify(`${c.name} is already the same in both`, 'info');
    else run();
  };

  const adopt = (c: McpServerComparison) => {
    if (!source || !c.targetEntry)
      return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
    const { disabled: _off, ...entry } = c.targetEntry;
    const run = () =>
      save('source', { ...source.servers, [c.name]: entry }, `Copied ${c.name} into the reference`);
    if (c.status === 'diff')
      prompt.confirm(`Overwrite ${c.name} in the reference with ${ide.name}'s?`, run);
    else if (c.status === 'synced') notify(`${c.name} is already the same in both`, 'info');
    else run();
  };

  const pushAllMissing = () => {
    if (!target) return;
    const missing = comparisons.filter((c) => c.status === 'missing-in-target');
    if (missing.length === 0) return notify('Every reference server is already in the IDE', 'info');
    const servers = { ...target.servers };
    for (const c of missing) if (c.sourceEntry) servers[c.name] = c.sourceEntry;
    prompt.confirm(`Copy ${missing.length} missing server(s) to ${ide.name}?`, () =>
      save('target', servers, `Copied ${missing.length} server(s) to ${ide.name}`),
    );
  };

  const loadTools = (c: McpServerComparison) => {
    const entry = c.targetEntry ?? c.sourceEntry;
    if (!entry) return;
    setTools((prev) => ({ ...prev, [c.name]: 'loading' }));
    listServerTools(entry, root).then((result) => {
      setTools((prev) => ({ ...prev, [c.name]: result }));
      if (result.error) notify(`${c.name}: ${result.error}`, 'error');
    });
  };

  const setToken = (token: RequiredToken) =>
    prompt.ask(
      `${token.key} =`,
      (value) => {
        if (!value.trim()) return notify('Nothing entered — left as it was', 'info');
        setEnvValue(root, token.key, value.trim());
        notify(`Set ${token.key} in ${ENV_FILE}`, 'ok');
        reload();
      },
      { secret: true },
    );

  useInput(
    (input) => {
      if (!source || !target) return;
      if (input === 'P') pushAllMissing();
      else if (input === 'e') handoff({ type: 'edit', path: source.path });
      else if (input === 'E') handoff({ type: 'edit', path: target.path });
      else if (input === 'n' && !target.exists)
        save('target', {}, `Created ${displayPath(target.path, root)}`);

      if (current?.kind === 'token') {
        if (input === 's') setToken(current.token);
        return;
      }
      if (current?.kind !== 'server') return;
      const c = current.comparison;
      if (input === 'p') push(c);
      else if (input === 'a') adopt(c);
      else if (input === 'i') loadTools(c);
      else if (input === 'o') revealPath(c.targetEntry ? target.path : source.path);
      else if (input === 'd') {
        if (!c.targetEntry) return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
        const disabled = !c.targetEntry.disabled;
        save(
          'target',
          {
            ...target.servers,
            [c.name]: { ...c.targetEntry, disabled: disabled || undefined },
          },
          `${disabled ? 'Disabled' : 'Enabled'} ${c.name} in ${ide.name}`,
        );
      } else if (input === 'x') {
        if (!c.targetEntry) return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
        prompt.confirm(`Remove ${c.name} from ${ide.name}'s config?`, () => {
          const { [c.name]: _removed, ...rest } = target.servers;
          save('target', rest, `Removed ${c.name} from ${ide.name}`);
        });
      }
    },
    { isActive: !prompt.isOpen && Boolean(ide.mcp) },
  );

  const hints: Hint[] =
    current?.kind === 'token'
      ? [
          {
            key: 's',
            label: 'set token',
            onPress: () => setToken(current.token),
          },
        ]
      : [
          { key: 'p', label: 'to IDE' },
          { key: 'a', label: 'to reference' },
          { key: 'P', label: 'all missing', onPress: pushAllMissing },
          { key: 'd', label: 'on/off' },
          { key: 'x', label: 'remove' },
          { key: 'i', label: 'tools' },
          { key: 'e/E', label: 'edit ref/IDE' },
        ];

  const scope = ide.mcp?.scope === 'user' ? 'every repo' : 'this repo';
  const header =
    prompt.line ??
    (source && target ? (
      <Text wrap="truncate" color={colors.muted}>
        {source.exists ? displayPath(source.path, root) : 'no reference yet'} →{' '}
        {displayPath(target.path, root)}
        <Text color={ide.mcp?.scope === 'user' ? colors.warn : colors.muted}> ({scope})</Text>
        {!target.exists && <Text color={colors.warn}> · missing, [n] creates it</Text>}
        {source.error && <Text color={colors.error}> · reference is not valid JSON</Text>}
        {target.error && <Text color={colors.error}> · IDE config is not valid JSON</Text>}
      </Text>
    ) : (
      <Text color={colors.muted}>{error ?? 'Reading MCP configs…'}</Text>
    ));

  const detailRows = Math.max(
    3,
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) - 2,
  );

  const lines = (row: Row): { text: string; color: string }[] => {
    if (row.kind === 'token') {
      const value = tokenValue(row.token.key);
      return [
        {
          text: value
            ? `set (${mask(value)})${data?.env[row.token.key] ? '' : ' — from the environment'}`
            : `missing — [s] sets it in ${ENV_FILE}`,
          color: value ? colors.ok : colors.warn,
        },
        { text: '', color: colors.muted },
        {
          text: `needed by ${row.token.servers.join(', ')}`,
          color: colors.muted,
        },
      ];
    }

    const c = row.comparison;
    const out: { text: string; color: string }[] = [
      {
        text: `${STATUS_LABEL[c.status]}${c.targetEntry?.disabled ? ' · disabled in the IDE' : ''}`,
        color:
          c.status === 'synced' ? colors.ok : c.status === 'diff' ? colors.warn : colors.highlight,
      },
    ];
    const needed = tokens.filter((t) => t.servers.includes(c.name));
    for (const token of needed) {
      out.push({
        text: `needs ${token.key}: ${tokenValue(token.key) ? 'set' : 'missing'}`,
        color: tokenValue(token.key) ? colors.ok : colors.warn,
      });
    }
    const cached = tools[c.name];
    if (cached === 'loading')
      out.push({
        text: 'Starting the server to list its tools…',
        color: colors.muted,
      });
    else if (cached?.error) out.push({ text: `tools: ${cached.error}`, color: colors.error });
    else if (cached) {
      out.push({ text: `${cached.tools.length} tools:`, color: colors.text });
      for (const tool of cached.tools) {
        out.push({
          text: `  ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`,
          color: colors.muted,
        });
      }
    } else {
      out.push({
        text: '[i] or Enter starts it and lists its tools',
        color: colors.muted,
      });
    }
    if (c.status === 'diff' && c.sourceEntry && c.targetEntry) {
      for (const field of getDiffFields(c.sourceEntry, c.targetEntry)) {
        out.push({ text: `${field.field}:`, color: colors.text });
        out.push({ text: `  - ref ${field.source}`, color: colors.error });
        out.push({ text: `  + ide ${field.target}`, color: colors.ok });
      }
    } else {
      for (const line of JSON.stringify(c.targetEntry ?? c.sourceEntry, null, 2).split('\n')) {
        out.push({ text: line, color: colors.muted });
      }
    }
    return out;
  };

  //? After every hook, not before them: switching IDE on the IDE tab changes
  //? this answer without remounting the view
  if (!ide.mcp) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>{ide.name} has no MCP config agenti knows how to manage.</Text>
        <Text color={colors.muted}>Pick another IDE on the IDE tab to compare its servers.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={`MCP · ${ide.name}`}
        items={items}
        emptyText="No servers in the reference or the IDE config."
        detailTitle={
          current?.kind === 'token' ? current.token.key : (current?.comparison.name ?? 'Server')
        }
        renderDetail={(item) =>
          item?.value ? (
            <Box flexDirection="column">
              {lines(item.value)
                .slice(0, detailRows)
                .map((line, index) => (
                  <Text key={index} color={line.color} wrap="truncate">
                    {line.text || ' '}
                  </Text>
                ))}
            </Box>
          ) : null
        }
        hints={hints}
        reservedChrome={['viewHeader']}
        activateLabel="tools / set"
        initialSelectedId={session.selected.mcp}
        isInputActive={!prompt.isOpen}
        onActivate={(item) => {
          if (item.value?.kind === 'token') setToken(item.value.token);
          else if (item.value?.kind === 'server') loadTools(item.value.comparison);
        }}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.mcp = item?.id;
        }}
      />
    </Box>
  );
};

export default McpView;

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

import { mcpTargetsFor } from '../../../core/ides';
import {
  type ApprovalState,
  buildComparisons,
  ENV_FILE,
  getDiffFields,
  getMcpApprovals,
  getRequiredTokens,
  listServerTools,
  type McpServerComparison,
  type McpServerEntry,
  type McpServerStatus,
  type McpToolsResult,
  readEnvFile,
  readMcpTarget,
  readSourceMcp,
  type RequiredToken,
  setEnvValue,
  setMcpApproval,
  setMcpServer,
  writeServers,
} from '../../../core/mcp';
import revealPath from '@/dev-tools/utils/system/revealPath';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import type { ViewProps } from '../../types';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';

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
/** Who sees a scope's servers, in the words the header has room for. */
const SCOPE_LABEL = {
  project: 'this repo, shared',
  local: 'this repo, only you',
  user: 'every repo',
};

export const McpView = ({
  scope,
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

  const targets = mcpTargetsFor(ide, scope.kind);
  const [targetIndex, setTargetIndex] = useState(0);
  const targetDef = targets[Math.min(targetIndex, targets.length - 1)];
  //? Claude Code ignores `disabled` in .mcp.json; what it honours for a project
  //? server is each user's approval, so that is what this scope shows and sets
  const hasApprovals =
    ide.id === 'claude-code' && targetDef?.kind === 'file' && targetDef.scope === 'project';

  const { data, error, reload } = useLoader(() => {
    const target = targetDef ? readMcpTarget(root, targetDef) : undefined;
    return {
      source: readSourceMcp(root),
      target,
      env: readEnvFile(root),
      approvals:
        hasApprovals && target
          ? getMcpApprovals(root, Object.keys(target.servers))
          : ({} as Record<string, ApprovalState>),
    };
  }, [root, ide.id, targetIndex, refreshKey]);

  const source = data?.source;
  const target = data?.target;
  const approvals = data?.approvals ?? {};
  const cycleScope = () => {
    if (targets.length < 2) return notify(`${ide.name} has one MCP scope here`, 'info');
    setTargetIndex((at) => (at + 1) % targets.length);
  };
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
        hint: `${STATUS_LABEL[comparison.status]}${comparison.targetEntry?.disabled ? ' · off' : ''}${
          approvals[comparison.name] && approvals[comparison.name] !== 'approved'
            ? ` · ${approvals[comparison.name]}`
            : ''
        }${toolsHint}`,
        hintColor: approvals[comparison.name] === 'pending' ? colors.warn : undefined,
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

  const saveSource = (servers: Record<string, McpServerEntry>, message: string) => {
    if (!source) return;
    try {
      writeServers(source, servers);
      notify(message, 'ok');
    } catch (cause) {
      notify((cause as Error).message, 'error');
    }
    reload();
  };

  /** One server into (or, with no entry, out of) the IDE's scope — a file write, or `claude mcp`. */
  const saveTarget = async (name: string, entry: McpServerEntry | undefined, message: string) => {
    if (!target) return;
    const result = await setMcpServer(root, target, name, entry);
    notify(result.ok ? message : result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const push = (c: McpServerComparison) => {
    if (!target || !c.sourceEntry)
      return notify(`${c.name} is not in the reference config`, 'warn');
    const entry = target.supportsDisabled
      ? { ...c.sourceEntry, disabled: c.targetEntry?.disabled }
      : c.sourceEntry;
    const run = () => void saveTarget(c.name, entry, `Copied ${c.name} to ${ide.name}`);
    if (c.status === 'diff') {
      prompt.confirm(`Overwrite ${c.name} in ${ide.name}'s config with the reference?`, run);
    } else if (c.status === 'synced') notify(`${c.name} is already the same in both`, 'info');
    else run();
  };

  const adopt = (c: McpServerComparison) => {
    if (!source || !c.targetEntry)
      return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
    const { disabled: _off, ...entry } = c.targetEntry;
    const run = () =>
      saveSource({ ...source.servers, [c.name]: entry }, `Copied ${c.name} into the reference`);
    if (c.status === 'diff') {
      prompt.confirm(`Overwrite ${c.name} in the reference with ${ide.name}'s?`, run);
    } else if (c.status === 'synced') notify(`${c.name} is already the same in both`, 'info');
    else run();
  };

  const pushAllMissing = () => {
    if (!target) return;
    const missing = comparisons.filter((c) => c.status === 'missing-in-target');
    if (missing.length === 0) return notify('Every reference server is already in the IDE', 'info');
    prompt.confirm(`Copy ${missing.length} missing server(s) to ${ide.name}?`, async () => {
      let copied = 0;
      for (const c of missing) {
        //? One at a time, re-reading between: each write replaces the file, and
        //? Claude Code's CLI must not be run in parallel against its own config
        const fresh = targetDef ? readMcpTarget(root, targetDef) : undefined;
        if (!fresh || !c.sourceEntry) continue;
        if ((await setMcpServer(root, fresh, c.name, c.sourceEntry)).ok) copied += 1;
      }
      notify(
        `Copied ${copied} of ${missing.length} server(s) to ${ide.name}`,
        copied ? 'ok' : 'error',
      );
      reload();
    });
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

  const toggleDisabled = (c: McpServerComparison) => {
    if (!target || !c.targetEntry)
      return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
    if (!target.supportsDisabled || hasApprovals) {
      return notify(`${ide.name} has no per-server switch here — remove it, or deny it`, 'warn');
    }
    const disabled = !c.targetEntry.disabled;
    void saveTarget(
      c.name,
      { ...c.targetEntry, disabled: disabled || undefined },
      `${disabled ? 'Disabled' : 'Enabled'} ${c.name} in ${ide.name}`,
    );
  };

  const approve = (c: McpServerComparison, yes: boolean) => {
    if (!hasApprovals || !c.targetEntry) return;
    const result = setMcpApproval(root, c.name, yes);
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const removeFromIde = (c: McpServerComparison) => {
    if (!target || !c.targetEntry)
      return notify(`${c.name} is not in ${ide.name}'s config`, 'warn');
    prompt.confirm(
      `Remove ${c.name} from ${ide.name}'s config?`,
      () => void saveTarget(c.name, undefined, `Removed ${c.name} from ${ide.name}`),
    );
  };

  const missingCount = comparisons.filter((c) => c.status === 'missing-in-target').length;

  /**
   * The buttons for a row. The primary one follows the status: a server only
   * the reference has wants copying to the IDE, one only the IDE has wants
   * adopting, one that differs wants the reference pushed (the reference is the
   * source of truth), and one already in sync is most likely being looked at
   * for its tools.
   */
  const actionsFor = (row: Row): ToolbarAction[] => {
    if (row.kind === 'token') {
      return [
        { hotkey: 's', label: 'Set token', onPress: () => setToken(row.token), tone: 'primary' },
      ];
    }
    const c = row.comparison;
    const actions: ToolbarAction[] = [];
    if (c.sourceEntry && c.status !== 'synced') {
      actions.push({
        hotkey: 'p',
        label: c.status === 'diff' ? 'Overwrite IDE with reference' : 'Copy to IDE',
        onPress: () => push(c),
        tone: 'primary',
      });
    }
    if (c.targetEntry && c.status !== 'synced') {
      actions.push({
        hotkey: 'a',
        label: c.status === 'diff' ? 'Overwrite reference with IDE' : 'Copy to reference',
        onPress: () => adopt(c),
        tone: c.status === 'target-only' ? 'primary' : 'normal',
      });
    }
    actions.push({
      hotkey: 'i',
      label: tools[c.name] === 'loading' ? 'Listing tools…' : 'List tools',
      onPress: () => loadTools(c),
      disabled: tools[c.name] === 'loading',
      //? Unless approving is what it is waiting for — one primary per row
      tone: c.status === 'synced' && approvals[c.name] !== 'pending' ? 'primary' : 'normal',
    });
    if (c.targetEntry && hasApprovals) {
      const state = approvals[c.name];
      actions.push(
        {
          hotkey: 'y',
          label: 'Approve',
          onPress: () => approve(c, true),
          disabled: state === 'approved',
          tone: state === 'pending' ? 'primary' : 'normal',
        },
        {
          hotkey: 'n',
          label: 'Deny',
          onPress: () => approve(c, false),
          disabled: state === 'denied',
        },
      );
    } else if (c.targetEntry && target?.supportsDisabled) {
      actions.push({
        hotkey: 'd',
        label: c.targetEntry.disabled ? 'Enable in IDE' : 'Disable in IDE',
        onPress: () => toggleDisabled(c),
      });
    }
    if (c.targetEntry) {
      actions.push({
        hotkey: 'x',
        label: 'Remove from IDE',
        onPress: () => removeFromIde(c),
        tone: 'danger',
      });
    }
    if (missingCount > 1) {
      actions.push({
        hotkey: 'P',
        label: `Copy all ${missingCount} missing`,
        onPress: pushAllMissing,
      });
    }
    return actions;
  };

  useInput(
    (input) => {
      if (!source || !target) return;
      if (input === 'P') return pushAllMissing();
      if (input === 'S') return cycleScope();
      if (input === 'e') return handoff({ type: 'edit', path: source.path });
      //? Claude Code's own ~/.claude.json is not for hand-editing while it runs
      if (input === 'E' && target.file) return handoff({ type: 'edit', path: target.location });
      if (input === 'n' && target.file && !target.exists) {
        writeServers(target.file, {});
        notify(`Created ${displayPath(target.location, root)}`, 'ok');
        return reload();
      }

      if (current?.kind === 'token') {
        if (input === 's') setToken(current.token);
        return;
      }
      if (current?.kind !== 'server') return;
      const c = current.comparison;
      if (input === 'p') push(c);
      else if (input === 'a') adopt(c);
      else if (input === 'i') loadTools(c);
      else if (input === 'o') revealPath(c.targetEntry ? target.location : source.path);
      else if (input === 'd') toggleDisabled(c);
      else if (input === 'y') approve(c, true);
      else if (input === 'n') approve(c, false);
      else if (input === 'x') removeFromIde(c);
    },
    { isActive: !prompt.isOpen && Boolean(targetDef) },
  );

  //? Row actions are the toolbar's; the strip keeps the ones about the files
  const hints: Hint[] = [
    {
      key: 'e',
      label: 'edit reference',
      onPress: source ? () => handoff({ type: 'edit', path: source.path }) : undefined,
    },
    ...(target?.file
      ? [
          {
            key: 'E',
            label: 'edit IDE config',
            onPress: () => handoff({ type: 'edit', path: target.location }),
          },
        ]
      : []),
    ...(targets.length > 1
      ? [{ key: 'S', label: `scope: ${targetDef?.scope}`, onPress: cycleScope }]
      : []),
    ...(target?.file && !target.exists ? [{ key: 'n', label: 'create IDE config' }] : []),
  ];

  const header =
    prompt.line ??
    (source && target ? (
      <Text wrap="truncate" color={colors.muted}>
        {source.exists ? displayPath(source.path, root) : 'no reference yet'} →{' '}
        {displayPath(target.location, root)}
        {target.file ? '' : ` (${targetDef?.scope} scope, via claude mcp)`}
        <Text color={target.scope === 'user' ? colors.warn : colors.muted}>
          {' '}
          ({SCOPE_LABEL[target.scope]})
        </Text>
        {target.file && !target.exists && (
          <Text color={colors.warn}> · missing, [n] creates it</Text>
        )}
        {source.error && <Text color={colors.error}> · reference is not valid JSON</Text>}
        {target.error && <Text color={colors.error}> · IDE config is not valid JSON</Text>}
      </Text>
    ) : (
      <Text color={colors.muted}>{error ?? 'Reading MCP configs…'}</Text>
    ));

  const detailRows = Math.max(
    3,
    //? less the toolbar and its rule
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) - 5,
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
        text: `${STATUS_LABEL[c.status]}${c.targetEntry?.disabled ? ' · disabled in the IDE' : ''}${
          approvals[c.name] ? ` · ${approvals[c.name]} for you` : ''
        }`,
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
  if (!targetDef) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>
          {ide.name} keeps no MCP servers {scope.kind === 'user' ? 'per user' : 'per repository'}{' '}
          that agenti knows how to manage.
        </Text>
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
              <Toolbar actions={actionsFor(item.value)} />
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

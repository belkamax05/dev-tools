import { relative } from 'node:path';
import { Text, useInput } from 'ink';
import { useCallback, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { type ThemeColors, useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  type AgentNode,
  type AgentStatus,
  deleteNode,
  getInventory,
  getNodeDiff,
  type Inventory,
  type OperationResult,
  readPreview,
  setLinkMode,
  syncNode,
  toggleLink,
} from '../../../core/agents';
import {
  adoptInstructions,
  getInstructions,
  type InstructionsStatus,
  linkInstructions,
  unlinkInstructions,
} from '../../../core/instructions';
import revealPath from '../../../utils/revealPath';
import Toolbar, { type ToolbarAction } from '../../Toolbar';
import type { ViewProps } from '../../types';
import useLoader from '../../useLoader';
import usePrompt from '../../usePrompt';

/**
 * The checkbox each row carries, one per status — three cells wide on every
 * row so the names after it line up.
 */
const CHECKBOX: Record<AgentStatus, string> = {
  synced: '[x]',
  implicit: '[~]',
  missing: '[ ]',
  mismatch: '[!]',
  orphan: '[+]',
  unknown: '[?]',
  unused: '[-]',
};

const DESCRIBE: Record<AgentStatus, string> = {
  synced: 'in the IDE, same as .agents',
  implicit: 'partly in the IDE',
  missing: 'not in the IDE',
  mismatch: 'the IDE copy differs from .agents',
  orphan: 'only in the IDE folder, not in .agents',
  unknown: 'something unexpected is in the way',
  unused: 'not read by this IDE',
};

const statusColor = (status: AgentStatus, colors: ThemeColors) =>
  status === 'synced'
    ? colors.ok
    : status === 'mismatch' || status === 'unknown'
      ? colors.warn
      : status === 'orphan'
        ? colors.highlight
        : colors.muted;

/**
 * How something in step got there: a link, a generated conversion, or a plain
 * copy. A folder is described by what is in it — a real folder of links (a
 * shared target like `.claude/commands`) is as linked as a folder link.
 */
const syncedKind = (node: AgentNode): string => {
  if (node.linkTarget || node.isLinked) return 'linked';
  //? In step and converted means it matches the rendering, marker included
  if (node.type === 'file') return node.isGenerated ? 'generated' : 'copy';
  const kinds = new Set((node.children ?? []).filter((c) => c.status === 'synced').map(syncedKind));
  return kinds.size === 1 ? ([...kinds][0] ?? 'copy') : kinds.size ? 'mixed' : 'copy';
};

const hintFor = (node: AgentNode): string => {
  if (node.status === 'synced') return syncedKind(node);
  if (node.status === 'mismatch') return 'differs';
  if (node.status === 'orphan') return 'IDE only';
  if (node.status === 'implicit') return 'partly';
  if (node.status === 'unknown') return '?';
  if (node.status === 'unused') return 'unused';
  return 'off';
};

const summary = (inventory: Inventory) => {
  const { counts } = inventory;
  const parts = [
    `${counts.synced} in sync`,
    counts.mismatch && `${counts.mismatch} differ`,
    counts.missing && `${counts.missing} off`,
    counts.orphan && `${counts.orphan} IDE-only`,
    counts.unknown && `${counts.unknown} unknown`,
  ].filter(Boolean);
  return parts.join(' · ');
};

/**
 * ` [3/15]` after a folder with more than one entry: how many of its direct
 * entries are in the IDE, out of how many there are. A folder with one entry
 * says the same thing with its checkbox alone.
 */
const countFor = (node: AgentNode): string => {
  const children = node.children ?? [];
  if (node.type !== 'directory' || children.length < 2) return '';
  const inIde = children.filter((child) => child.status === 'synced').length;
  return ` [${inIde}/${children.length}]`;
};

const INSTRUCTIONS_ID = '::instructions';

const INSTRUCTIONS_BOX: Record<InstructionsStatus, string> = {
  native: '[x]',
  synced: '[x]',
  missing: '[ ]',
  mismatch: '[!]',
  'no-source': '[+]',
  none: '[-]',
};

const INSTRUCTIONS_HINT: Record<InstructionsStatus, string> = {
  native: 'read natively',
  synced: 'linked',
  missing: 'off',
  mismatch: 'differs',
  'no-source': 'no AGENTS.md',
  none: '',
};

const INSTRUCTIONS_DESCRIBE: Record<InstructionsStatus, (ide: string) => string> = {
  native: (ide) => `${ide} reads AGENTS.md itself — nothing to keep in step`,
  synced: (ide) => `${ide}'s instructions point at AGENTS.md`,
  missing: (ide) => `${ide} does not see AGENTS.md yet`,
  mismatch: (ide) => `${ide}'s instructions file does not point at AGENTS.md`,
  'no-source': () => 'There is no AGENTS.md — the shared instructions every IDE reads',
  none: () => '',
};

/** The width of the fold triangle plus its margin, for rows that have none. */
const TWISTY_CELLS = 2;

/**
 * `.agents` against the IDE's folder: the web version's Agents page, for the
 * one repository agenti was started in.
 *
 * Every row has explicit controls rather than one big click target: a fold
 * triangle on folders and a checkbox that links or unlinks, each clickable on
 * its own. A click anywhere else on the row only selects it — opening a file
 * is never a side effect of pointing at it. What a file contains is shown on
 * request (`v` / Preview), and the actions for the selected row are buttons
 * in the detail pane, the likeliest one first and highlighted.
 */
export const AgentsView = ({
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
  //? The id, not the node: the node object is replaced on every reload, and a
  //? kept reference would go on describing the file as it was before the action
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.agents);
  //? Copies of the session's state, so changing them re-renders; written back
  //? so an editor handoff comes back with the same folders open
  const [expanded, setExpanded] = useState(() => new Set(session.expanded));
  const [preview, setPreviewState] = useState(session.preview);

  const {
    data: inventory,
    isLoading,
    error,
    reload,
  } = useLoader(() => getInventory(scope, ide), [root, scope.kind, ide.id, refreshKey]);
  //? Cheap — a couple of stats — so read fresh on every render rather than
  //? loaded, which keeps it in step after any action without a reload of its own
  const instructions = getInstructions(scope, ide);

  const setOpen = useCallback(
    (node: AgentNode, open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(node.relativePath);
        else next.delete(node.relativePath);
        session.expanded = next;
        return next;
      });
    },
    [session],
  );

  const togglePreview = () => {
    setPreviewState((on) => {
      session.preview = !on;
      return !on;
    });
  };

  const apply = (result: OperationResult) => {
    notify(result.message, result.ok ? 'ok' : 'warn');
    reload();
  };

  const toggle = (node: AgentNode) => {
    if (!inventory) return;
    if (node.status === 'mismatch' || node.status === 'unknown') {
      notify(
        `${node.relativePath} differs — [a] adopt the IDE's copy or [p] push .agents'`,
        'warn',
      );
      return;
    }
    if (node.status === 'orphan') {
      notify(`${node.relativePath} is only in the IDE — [a] adopts it into .agents`, 'warn');
      return;
    }
    if (node.status === 'unused') {
      notify(`${ide.name} has nowhere that reads ${node.relativePath}`, 'warn');
      return;
    }
    apply(toggleLink(inventory, node, node.status === 'missing' || node.status === 'implicit'));
  };

  const toRows = (nodes: AgentNode[], depth = 0): PickItem<AgentNode>[] =>
    nodes.flatMap((node) => {
      const isDir = node.type === 'directory';
      const isOpen = isDir && expanded.has(node.relativePath);
      const row: PickItem<AgentNode> = {
        id: node.relativePath,
        label: `${node.name}${countFor(node)}`,
        hint: hintFor(node),
        //? The two hints that mean "in the IDE, at least partly" stand out from
        //? the dimmed rest; "off" and the others stay as they are
        hintColor: ['linked', 'generated', 'partly'].includes(hintFor(node))
          ? colors.accent
          : undefined,
        value: node,
        indent: depth * 2 + (isDir ? 0 : TWISTY_CELLS),
        controls: [
          ...(isDir
            ? [
                {
                  id: 'fold',
                  glyph: isOpen ? '▾' : '▸',
                  color: colors.text,
                  onPress: () => setOpen(node, !isOpen),
                },
              ]
            : []),
          {
            id: 'link',
            glyph: CHECKBOX[node.status],
            color: statusColor(node.status, colors),
            onPress: () => toggle(node),
          },
        ],
      };
      return [row, ...(isOpen && node.children ? toRows(node.children, depth + 1) : [])];
    });

  const instructionsRow: PickItem<AgentNode>[] =
    instructions.status === 'none'
      ? []
      : [
          {
            id: INSTRUCTIONS_ID,
            label: 'AGENTS.md',
            hint: INSTRUCTIONS_HINT[instructions.status],
            hintColor: instructions.status === 'synced' ? colors.accent : undefined,
            indent: TWISTY_CELLS,
            controls: [
              {
                id: 'link',
                glyph: INSTRUCTIONS_BOX[instructions.status],
                color:
                  instructions.status === 'synced' || instructions.status === 'native'
                    ? colors.ok
                    : instructions.status === 'mismatch'
                      ? colors.warn
                      : colors.muted,
                onPress: () => toggleInstructions(),
              },
            ],
          },
        ];
  const items = [...instructionsRow, ...(inventory ? toRows(inventory.nodes) : [])];
  const onInstructions = currentId === INSTRUCTIONS_ID;
  const current = items.find((item) => item.id === currentId)?.value;

  const toggleInstructions = () => {
    const state = instructions;
    if (state.status === 'native') return notify(`${ide.name} reads AGENTS.md itself`, 'info');
    if (state.status === 'synced') return apply(unlinkInstructions(state));
    if (state.status === 'no-source') {
      return notify(
        state.targetHasContent
          ? '[a] adopts the IDE file as AGENTS.md'
          : 'Write an AGENTS.md first ([e])',
        'warn',
      );
    }
    if (state.status === 'mismatch' && state.mode === 'link') {
      return notify(
        `${state.targetPath} has its own content — [p] replaces it with a link`,
        'warn',
      );
    }
    apply(linkInstructions(state));
  };

  const instructionsActions = (): ToolbarAction[] => {
    const state = instructions;
    const target = state.targetPath ? relative(root, state.targetPath) : undefined;
    const actions: ToolbarAction[] = [];
    if (state.status === 'missing' || (state.status === 'mismatch' && state.mode === 'import')) {
      actions.push({
        hotkey: 'Space',
        label: state.mode === 'import' ? `Import from ${target}` : `Link ${target}`,
        onPress: toggleInstructions,
        tone: 'primary',
      });
    }
    if (state.status === 'synced') {
      actions.push({ hotkey: 'Space', label: `Remove ${target}`, onPress: toggleInstructions });
    }
    if (state.status === 'no-source' && state.targetHasContent) {
      actions.push({
        hotkey: 'a',
        label: `Adopt ${target} as AGENTS.md`,
        onPress: () => apply(adoptInstructions(state)),
        tone: 'primary',
      });
    }
    if (state.status === 'mismatch' && state.mode === 'link') {
      actions.push({
        hotkey: 'p',
        label: `Replace ${target} with a link`,
        onPress: () =>
          prompt.confirm(`Replace ${target} (and what it says) with a link to AGENTS.md?`, () =>
            apply(linkInstructions(state, { force: true })),
          ),
        tone: 'danger',
      });
    }
    actions.push(
      { hotkey: 'v', label: 'Preview', onPress: togglePreview, isOn: preview },
      {
        hotkey: 'e',
        label: state.sourceExists ? 'Edit AGENTS.md' : 'Write AGENTS.md',
        onPress: () => handoff({ type: 'edit', path: state.sourcePath }),
        tone: state.status === 'no-source' && !state.targetHasContent ? 'primary' : 'normal',
      },
    );
    return actions;
  };

  const diff = useLoader(
    () =>
      preview && current?.status === 'mismatch' && current.type === 'file'
        ? getNodeDiff(current)
        : undefined,
    [current?.relativePath, current?.status, inventory, preview],
  );

  const edit = (node: AgentNode) => {
    if (node.type !== 'file') return;
    handoff({
      type: 'edit',
      path: node.status === 'orphan' && node.targetPath ? node.targetPath : node.sourcePath,
    });
  };

  const adopt = (node: AgentNode) => {
    if (!inventory) return;
    if (node.status !== 'mismatch' && node.status !== 'orphan' && node.status !== 'implicit') {
      notify('Nothing to adopt — only differing or IDE-only entries can be', 'warn');
      return;
    }
    const overwrite = node.status === 'orphan' ? '' : ', overwriting it there';
    prompt.confirm(`Adopt the IDE's ${node.relativePath} into .agents${overwrite}?`, () =>
      apply(syncNode(inventory, node, 'pull')),
    );
  };

  const push = (node: AgentNode) => {
    if (!inventory) return;
    if (node.status !== 'mismatch' && node.status !== 'implicit') {
      notify('Nothing to push — only differing entries can be', 'warn');
      return;
    }
    prompt.confirm(`Push .agents/${node.relativePath} over the IDE's copy?`, () =>
      apply(syncNode(inventory, node, 'push')),
    );
  };

  const remove = (node: AgentNode) => {
    const where = node.status === 'orphan' ? `${ide.folder}/` : '.agents/';
    prompt.confirm(`Delete ${where}${node.relativePath} for good?`, () => apply(deleteNode(node)));
  };

  const switchMode = () => {
    if (!inventory) return;
    const next = inventory.mode === 'directory' ? 'granular' : 'directory';
    const message =
      next === 'directory'
        ? `Replace ${ide.folder} with one link to .agents?`
        : `Replace the ${ide.folder} link with a folder of per-entry links?`;
    prompt.confirm(message, () => apply(setLinkMode(inventory, next)));
  };

  const reveal = (node: AgentNode) =>
    revealPath(
      (node.status === 'orphan' || node.status === 'synced') && node.targetPath
        ? node.targetPath
        : node.sourcePath,
    );

  /** The buttons for a row, the one it is most likely selected for marked primary. */
  const actionsFor = (node: AgentNode): ToolbarAction[] => {
    const isFile = node.type === 'file';
    const { status } = node;
    const actions: ToolbarAction[] = [];
    if (status === 'missing' || status === 'implicit' || status === 'synced') {
      actions.push({
        hotkey: 'Space',
        label: status === 'synced' ? 'Unlink' : 'Link',
        onPress: () => toggle(node),
        tone: status === 'synced' ? 'normal' : 'primary',
      });
    }
    if (status === 'mismatch' || status === 'implicit') {
      actions.push({
        hotkey: 'p',
        label: 'Push .agents → IDE',
        onPress: () => push(node),
        tone: status === 'mismatch' ? 'primary' : 'normal',
      });
    }
    if (status === 'mismatch' || status === 'orphan' || status === 'implicit') {
      actions.push({
        hotkey: 'a',
        label: 'Adopt IDE → .agents',
        onPress: () => adopt(node),
        tone: status === 'orphan' ? 'primary' : 'normal',
      });
    }
    if (isFile && status !== 'unused') {
      actions.push(
        {
          hotkey: 'v',
          label: status === 'mismatch' ? 'Diff' : 'Preview',
          onPress: togglePreview,
          isOn: preview,
          tone: status === 'synced' ? 'primary' : 'normal',
        },
        { hotkey: 'e', label: 'Edit', onPress: () => edit(node) },
      );
    } else if (isFile) {
      actions.push({ hotkey: 'e', label: 'Edit', onPress: () => edit(node) });
    }
    actions.push(
      { hotkey: 'o', label: 'Reveal', onPress: () => reveal(node) },
      { hotkey: 'x', label: 'Delete', onPress: () => remove(node), tone: 'danger' },
    );
    return actions;
  };

  useInput(
    (input, key) => {
      if (onInstructions) {
        const state = instructions;
        if (input === ' ') toggleInstructions();
        else if (input === 'v') togglePreview();
        else if (input === 'e') handoff({ type: 'edit', path: state.sourcePath });
        else if (input === 'a' || input === 'p') {
          instructionsActions()
            .find((action) => action.hotkey === input)
            ?.onPress();
        }
        return;
      }
      if (!inventory || !current) return;
      const node = current;
      if (key.rightArrow || input === 'l') {
        if (node.type === 'directory') setOpen(node, true);
      } else if (key.leftArrow || input === 'h') {
        if (node.type === 'directory') setOpen(node, false);
      } else if (input === ' ') toggle(node);
      else if (input === 'a') adopt(node);
      else if (input === 'p') push(node);
      else if (input === 'v') togglePreview();
      else if (input === 'e') edit(node);
      else if (input === 'x') remove(node);
      else if (input === 'm' && inventory.canSwitchMode) switchMode();
      else if (input === 'o') reveal(node);
    },
    { isActive: !prompt.isOpen },
  );

  const hints: Hint[] = [
    { key: '←/→', label: 'fold' },
    { key: 'Space', label: 'link' },
    { key: 'v', label: 'preview', onPress: togglePreview },
    ...(inventory?.canSwitchMode
      ? [{ key: 'm', label: `mode: ${inventory.mode}`, onPress: switchMode }]
      : []),
  ];

  const header =
    prompt.line ??
    (inventory ? (
      <Text wrap="truncate" color={colors.muted}>
        {scope.kind === 'user' ? '~/.agents' : '.agents'} →{' '}
        {inventory.targets.length
          ? inventory.targets.map((target) => relative(root, target)).join(', ')
          : `nothing — ${ide.name} keeps no files here`}
        {inventory.canSwitchMode ? <Text color={colors.accent}> · {inventory.mode}</Text> : null}
        {inventory.hasSource ? ` · ${summary(inventory)}` : ''}
      </Text>
    ) : (
      <Text color={colors.muted}>{error ?? 'Reading .agents…'}</Text>
    ));

  //? Rows the detail pane can give a preview: everything the chrome leaves,
  //? less the status lines and the toolbar drawn above it
  const previewRows = Math.max(
    3,
    //? toolbar (two rows and its rule), three status lines, one blank
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) - 7,
  );

  const renderInstructions = () => {
    const state = instructions;
    const body = preview ? readPreview(state.sourcePath) : undefined;
    return (
      <Box flexDirection="column">
        <Toolbar actions={instructionsActions()} />
        <Text color={colors.text} wrap="truncate">
          {INSTRUCTIONS_BOX[state.status]} {INSTRUCTIONS_DESCRIBE[state.status](ide.name)}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          source {relative(root, state.sourcePath)}
          {state.sourceExists ? '' : ' (not written yet)'}
        </Text>
        {state.targetPath && (
          <Text color={colors.muted} wrap="truncate">
            ide{'    '}
            {relative(root, state.targetPath)} (
            {state.mode === 'import' ? 'imports it' : 'links to it'})
          </Text>
        )}
        {body !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            {body
              .split('\n')
              .slice(0, previewRows)
              .map((line, index) => (
                <Text key={index} wrap="truncate" color={colors.text}>
                  {line || ' '}
                </Text>
              ))}
          </Box>
        )}
      </Box>
    );
  };

  const renderDetail = (item: PickItem<AgentNode> | undefined) => {
    if (item?.id === INSTRUCTIONS_ID) return renderInstructions();
    const node = item?.value;
    if (!node) return null;
    const rel = (path: string | undefined) => (path ? relative(root, path) : '—');

    const body =
      node.type !== 'file' || !preview
        ? undefined
        : node.status === 'mismatch'
          ? //? From the first hunk: git's header repeats both absolute paths, which
            //? the lines above already show, and costs four rows to say it
            (diff.data?.slice(Math.max(0, diff.data.indexOf('@@'))) ??
            (diff.isLoading ? 'Diffing…' : 'No textual difference.'))
          : readPreview(
              node.status === 'orphan' && node.targetPath ? node.targetPath : node.sourcePath,
            );

    return (
      <Box flexDirection="column">
        <Toolbar actions={actionsFor(node)} />
        <Text color={statusColor(node.status, colors)} wrap="truncate">
          {CHECKBOX[node.status]} {DESCRIBE[node.status]}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          source {node.status === 'orphan' ? '—' : rel(node.sourcePath)}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          ide{'    '}
          {rel(node.targetPath)}
          {node.linkTarget ? ` → ${node.linkTarget}` : ''}
        </Text>
        {node.type === 'file' && !preview && (
          <Box marginTop={1}>
            <Text color={colors.muted}>
              [v] {node.status === 'mismatch' ? 'shows the diff' : 'shows the file'} here
            </Text>
          </Box>
        )}
        {body !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            {body
              .split('\n')
              .slice(0, previewRows)
              .map((line, index) => (
                <Text
                  key={index}
                  wrap="truncate"
                  color={
                    node.status !== 'mismatch'
                      ? colors.text
                      : line.startsWith('+')
                        ? colors.ok
                        : line.startsWith('-')
                          ? colors.error
                          : line.startsWith('@@')
                            ? colors.accent
                            : colors.muted
                  }
                >
                  {line || ' '}
                </Text>
              ))}
          </Box>
        )}
      </Box>
    );
  };

  const emptyText = !inventory
    ? isLoading
      ? 'Reading…'
      : (error ?? 'Nothing to show.')
    : inventory.hasSource
      ? '.agents is empty.'
      : `No .agents folder here, and nothing in ${ide.folder} to adopt into one.`;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={
          inventory?.hasSource === false
            ? `${ide.folder} (no .agents yet)`
            : `.agents (${items.length})`
        }
        items={items}
        emptyText={emptyText}
        detailTitle={onInstructions ? 'Instructions' : (current?.relativePath ?? 'Entry')}
        renderDetail={renderDetail}
        hints={hints}
        reservedChrome={['viewHeader']}
        activateLabel="fold / preview"
        //? A click selects; the row's own triangle and checkbox are the actions
        activateOnClick={false}
        initialSelectedId={session.selected.agents}
        isInputActive={!prompt.isOpen}
        onActivate={(item) => {
          if (item.id === INSTRUCTIONS_ID) return togglePreview();
          const node = item.value;
          if (!node) return;
          if (node.type === 'directory') setOpen(node, !expanded.has(node.relativePath));
          else togglePreview();
        }}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.agents = item?.id;
        }}
      />
    </Box>
  );
};

export default AgentsView;

import { relative } from 'node:path';
import { Text, useInput } from 'ink';
import { useCallback, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

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
import revealPath from '../../../utils/revealPath';
import type { ViewProps } from '../../types';
import useLoader from '../../useLoader';
import usePrompt from '../../usePrompt';

/** One glyph per status, drawn where the web version had a checkbox. */
const MARK: Record<AgentStatus, string> = {
  synced: '●',
  implicit: '◐',
  missing: '○',
  mismatch: '≠',
  orphan: '+',
  unknown: '?',
};

const DESCRIBE: Record<AgentStatus, string> = {
  synced: 'in the IDE, same as .agents',
  implicit: 'partly in the IDE',
  missing: 'not in the IDE',
  mismatch: 'the IDE copy differs from .agents',
  orphan: 'only in the IDE folder, not in .agents',
  unknown: 'something unexpected is in the way',
};

const hintFor = (node: AgentNode): string => {
  if (node.status === 'synced') return node.linkTarget || node.isLinked ? 'linked' : 'copy';
  if (node.status === 'mismatch') return 'differs';
  if (node.status === 'orphan') return 'IDE only';
  if (node.status === 'implicit') return 'partly';
  if (node.status === 'unknown') return '?';
  return 'off';
};

const toRows = (nodes: AgentNode[], expanded: Set<string>, depth = 0): PickItem<AgentNode>[] =>
  nodes.flatMap((node) => {
    const isOpen = node.type === 'directory' && expanded.has(node.relativePath);
    const twisty = node.type === 'directory' ? (isOpen ? '▾ ' : '▸ ') : '  ';
    const row: PickItem<AgentNode> = {
      id: node.relativePath,
      label: `${'  '.repeat(depth)}${twisty}${MARK[node.status]} ${node.name}`,
      hint: hintFor(node),
      value: node,
    };
    return [row, ...(isOpen && node.children ? toRows(node.children, expanded, depth + 1) : [])];
  });

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
 * `.agents` against the IDE's folder: the web version's Agents page, for the
 * one repository agenti was started in.
 *
 * A tree rather than two: the web version's second tree was for comparing two
 * repositories, which a single-repo tool has no use for. What each row can do
 * follows its status, as the web version's buttons did — link or unlink what
 * is in sync or missing, push or adopt what differs, adopt what only the IDE
 * has.
 */
export const AgentsView = ({
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
  //? A copy of the session's set, so expanding re-renders; written back so an
  //? editor handoff comes back to the same folders open
  const [expanded, setExpanded] = useState(() => new Set(session.expanded));

  const {
    data: inventory,
    isLoading,
    error,
    reload,
  } = useLoader(() => getInventory(root, ide), [root, ide.id, refreshKey]);
  const items = inventory ? toRows(inventory.nodes, expanded) : [];
  const current = items.find((item) => item.id === currentId)?.value;

  const diff = useLoader(
    () =>
      current?.status === 'mismatch' && current.type === 'file' ? getNodeDiff(current) : undefined,
    [current?.relativePath, current?.status, inventory],
  );

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
    apply(toggleLink(inventory, node, node.status === 'missing' || node.status === 'implicit'));
  };

  const edit = (node: AgentNode) => {
    if (node.type !== 'file') return;
    handoff({
      type: 'edit',
      path: node.status === 'orphan' ? node.targetPath : node.sourcePath,
    });
  };

  useInput(
    (input, key) => {
      if (!inventory || !current) return;
      const node = current;
      if (key.rightArrow || input === 'l') {
        if (node.type === 'directory') setOpen(node, true);
      } else if (key.leftArrow || input === 'h') {
        if (node.type === 'directory') setOpen(node, false);
      } else if (input === ' ') {
        toggle(node);
      } else if (input === 'a') {
        if (node.status !== 'mismatch' && node.status !== 'orphan' && node.status !== 'implicit') {
          notify('Nothing to adopt — only differing or IDE-only entries can be', 'warn');
          return;
        }
        const overwrite = node.status === 'orphan' ? '' : ', overwriting it there';
        prompt.confirm(`Adopt the IDE's ${node.relativePath} into .agents${overwrite}?`, () =>
          apply(syncNode(inventory, node, 'pull')),
        );
      } else if (input === 'p') {
        if (node.status !== 'mismatch' && node.status !== 'implicit') {
          notify('Nothing to push — only differing entries can be', 'warn');
          return;
        }
        prompt.confirm(`Push .agents/${node.relativePath} over the IDE's copy?`, () =>
          apply(syncNode(inventory, node, 'push')),
        );
      } else if (input === 'e') {
        edit(node);
      } else if (input === 'x') {
        const where = node.status === 'orphan' ? `${ide.folder}/` : '.agents/';
        prompt.confirm(`Delete ${where}${node.relativePath} for good?`, () =>
          apply(deleteNode(node)),
        );
      } else if (input === 'm') {
        const next = inventory.mode === 'directory' ? 'granular' : 'directory';
        const message =
          next === 'directory'
            ? `Replace ${ide.folder} with one link to .agents?`
            : `Replace the ${ide.folder} link with a folder of per-entry links?`;
        prompt.confirm(message, () => apply(setLinkMode(inventory, next)));
      } else if (input === 'o') {
        revealPath(
          node.status === 'orphan' || node.status === 'synced' ? node.targetPath : node.sourcePath,
        );
      }
    },
    { isActive: !prompt.isOpen },
  );

  const hints: Hint[] = [
    { key: '←/→', label: 'fold' },
    {
      key: 'Space',
      label: 'link',
      onPress: current ? () => toggle(current) : undefined,
    },
    { key: 'a', label: 'adopt' },
    { key: 'p', label: 'push' },
    {
      key: 'e',
      label: 'edit',
      onPress: current ? () => edit(current) : undefined,
    },
    { key: 'x', label: 'delete' },
    { key: 'm', label: 'mode' },
    { key: 'o', label: 'reveal' },
  ];

  const header =
    prompt.line ??
    (inventory ? (
      <Text wrap="truncate" color={colors.muted}>
        .agents → {ide.folder} · <Text color={colors.accent}>{inventory.mode}</Text>
        {inventory.hasSource ? ` · ${summary(inventory)}` : ''}
      </Text>
    ) : (
      <Text color={colors.muted}>{error ?? 'Reading .agents…'}</Text>
    ));

  //? Rows the detail pane can give a preview: everything the chrome leaves,
  //? less the status lines drawn above it
  const previewRows = Math.max(
    3,
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) - 7,
  );

  const renderDetail = (item: PickItem<AgentNode> | undefined) => {
    const node = item?.value;
    if (!node) return null;
    const rel = (path: string) => relative(root, path);
    const tone =
      node.status === 'synced'
        ? colors.ok
        : node.status === 'mismatch' || node.status === 'unknown'
          ? colors.warn
          : node.status === 'orphan'
            ? colors.highlight
            : colors.muted;

    const body =
      node.type !== 'file'
        ? undefined
        : node.status === 'mismatch'
          ? (diff.data ?? (diff.isLoading ? 'Diffing…' : 'No textual difference.'))
          : readPreview(node.status === 'orphan' ? node.targetPath : node.sourcePath);

    return (
      <Box flexDirection="column">
        <Text color={tone} wrap="truncate">
          {MARK[node.status]} {DESCRIBE[node.status]}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          source {node.status === 'orphan' ? '—' : rel(node.sourcePath)}
        </Text>
        <Text color={colors.muted} wrap="truncate">
          ide{'    '}
          {rel(node.targetPath)}
          {node.linkTarget ? ` → ${node.linkTarget}` : ''}
        </Text>
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
        detailTitle={current?.relativePath ?? 'Entry'}
        renderDetail={renderDetail}
        hints={hints}
        reservedChrome={['viewHeader']}
        activateLabel="fold / edit"
        initialSelectedId={session.selected.agents}
        isInputActive={!prompt.isOpen}
        onActivate={(item) => {
          const node = item.value;
          if (!node) return;
          if (node.type === 'directory') setOpen(node, !expanded.has(node.relativePath));
          else edit(node);
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

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
  deleteEverywhere,
  deleteNode,
  getInventory,
  getNodeDiff,
  type Inventory,
  type MergedNode,
  mergeInventories,
  type OperationResult,
  pushEverywhere,
  readPreview,
  setLinkMode,
  syncNode,
  toggleEverywhere,
} from '../../../core/agents';
import type { IdeDefinition } from '../../../core/ides';
import {
  adoptInstructions,
  getInstructions,
  type InstructionsState,
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
  synced: 'in every IDE that reads it, same as .agents',
  implicit: 'in some IDEs, or partly',
  missing: 'in none of the IDEs yet',
  mismatch: "an IDE's copy differs from .agents",
  orphan: 'only in an IDE, not in .agents',
  unknown: 'something unexpected is in the way',
  unused: 'none of the IDEs reads this',
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

const hintForStatus = (status: AgentStatus): string =>
  status === 'mismatch'
    ? 'differs'
    : status === 'orphan'
      ? 'IDE only'
      : status === 'implicit'
        ? 'partly'
        : status === 'unknown'
          ? '?'
          : status === 'unused'
            ? 'unused'
            : 'off';

/** One IDE's view of an entry, in a word. */
const hintFor = (node: AgentNode): string =>
  node.status === 'synced' ? syncedKind(node) : hintForStatus(node.status);

/** Every IDE's view at once: the shared word if they agree on how, `mixed` if not. */
const mergedHint = (node: MergedNode): string => {
  if (node.status !== 'synced') return hintForStatus(node.status);
  const kinds = new Set(
    Object.values(node.perIde)
      .filter((own) => own.status === 'synced')
      .map(syncedKind),
  );
  return kinds.size === 1 ? ([...kinds][0] ?? 'linked') : 'mixed';
};

const summary = (inventory: Inventory) => {
  const { counts } = inventory;
  return [
    `${counts.synced} in sync`,
    counts.mismatch && `${counts.mismatch} differ`,
    counts.missing && `${counts.missing} off`,
    counts.orphan && `${counts.orphan} IDE-only`,
    counts.unknown && `${counts.unknown} unknown`,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * ` [3/15]` after a folder with more than one entry: how many of its direct
 * entries are in step everywhere, out of how many there are.
 */
const countFor = (node: MergedNode): string => {
  const children = (node.children ?? []).filter((child) => child.status !== 'unused');
  if (node.type !== 'directory' || children.length < 2) return '';
  const inStep = children.filter((child) => child.status === 'synced').length;
  return ` [${inStep}/${children.length}]`;
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

/** Several IDEs' instruction states as one, the way `combineStatus` does for entries. */
const combineInstructions = (states: InstructionsState[]): InstructionsStatus => {
  const relevant = states.map((state) => state.status).filter((status) => status !== 'none');
  if (relevant.length === 0) return 'none';
  if (relevant.includes('no-source')) return 'no-source';
  if (relevant.includes('mismatch')) return 'mismatch';
  if (relevant.every((status) => status === 'native')) return 'native';
  if (relevant.every((status) => status === 'synced' || status === 'native')) return 'synced';
  return 'missing';
};

/** The width of the fold triangle plus its margin, for rows that have none. */
const TWISTY_CELLS = 2;

type Results = { ide: IdeDefinition; result: OperationResult }[];

/**
 * `.agents` against every IDE this scope is kept in step with, as one tree.
 *
 * A row's checkbox means "this entry is on" — in every IDE that reads it, each
 * in its own way (a link here, a generated copy there). Linking, pushing and
 * deleting act on all of them; the detail pane lists what each IDE has.
 * Adopting takes one IDE's copy into `.agents`, so it — like preview and diff
 * — works on the IDE picked in the header (`[` / `]`).
 *
 * Every row has explicit controls rather than one big click target: a fold
 * triangle on folders and the checkbox, each clickable on its own. A click
 * anywhere else only selects the row.
 */
export const AgentsView = ({
  scope,
  root,
  ide,
  ides,
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
  const ideKey = ides.map((one) => one.id).join(',');

  const {
    data: inventories = [],
    isLoading,
    error,
    reload,
  } = useLoader(
    () => ides.map((one) => getInventory(scope, one)),
    [root, scope.kind, ideKey, refreshKey],
  );
  const focused = inventories.find((inventory) => inventory.ide.id === ide.id) ?? inventories[0];
  const merged = mergeInventories(inventories);
  //? Cheap — a couple of stats each — so read fresh on every render rather than
  //? loaded, which keeps them in step after any action without a reload of their own
  const instructions = ides
    .map((one) => ({ ide: one, state: getInstructions(scope, one) }))
    .filter(({ state }) => state.status !== 'none');
  const instructionsStatus = combineInstructions(instructions.map(({ state }) => state));

  const setOpen = useCallback(
    (path: string, open: boolean) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.add(path);
        else next.delete(path);
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

  /** Several IDEs' results as one status line: all well, or the first that was not. */
  const report = (verb: string, past: string, what: string, results: Results) => {
    if (results.length === 0)
      return notify(`Nothing to ${verb} — ${what} is already that way`, 'info');
    const failed = results.find(({ result }) => !result.ok);
    if (failed) notify(`${failed.ide.name}: ${failed.result.message}`, 'warn');
    else notify(`${past} ${what} in ${results.map(({ ide: one }) => one.name).join(', ')}`, 'ok');
    reload();
  };

  /** The entry as the header's IDE has it — what preview, diff and adopt use. */
  const focusedOf = (node: MergedNode): AgentNode | undefined =>
    node.perIde[ide.id] ?? Object.values(node.perIde)[0];

  const toggle = (node: MergedNode) => {
    if (node.status === 'mismatch' || node.status === 'unknown') {
      notify(
        `${node.relativePath} differs in an IDE — [a] adopt its copy or [p] push .agents'`,
        'warn',
      );
      return;
    }
    if (node.status === 'orphan') {
      notify(`${node.relativePath} is only in an IDE — [a] adopts it into .agents`, 'warn');
      return;
    }
    if (node.status === 'unused') {
      notify(
        `None of ${ides.map((one) => one.name).join(', ')} reads ${node.relativePath}`,
        'warn',
      );
      return;
    }
    const on = node.status === 'missing' || node.status === 'implicit';
    report(
      on ? 'link' : 'unlink',
      on ? 'Linked' : 'Unlinked',
      node.relativePath,
      toggleEverywhere(inventories, node, on),
    );
  };

  const toRows = (nodes: MergedNode[], depth = 0): PickItem<MergedNode>[] =>
    nodes.flatMap((node) => {
      const isDir = node.type === 'directory';
      const isOpen = isDir && expanded.has(node.relativePath);
      const hint = mergedHint(node);
      const row: PickItem<MergedNode> = {
        id: node.relativePath,
        label: `${node.name}${countFor(node)}`,
        hint,
        //? The hints that mean "in the IDEs, at least partly" stand out from
        //? the dimmed rest; "off" and the others stay as they are
        hintColor: ['linked', 'generated', 'mixed', 'partly'].includes(hint)
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
                  onPress: () => setOpen(node.relativePath, !isOpen),
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

  // --- instructions ------------------------------------------------------

  const toggleInstructions = () => {
    if (instructionsStatus === 'native')
      return notify('Every IDE here reads AGENTS.md itself', 'info');
    if (instructionsStatus === 'no-source') {
      const adoptable = instructions.find(({ state }) => state.targetHasContent);
      return notify(
        adoptable
          ? `[a] adopts ${relative(root, adoptable.state.targetPath ?? '')} as AGENTS.md`
          : 'Write an AGENTS.md first ([e])',
        'warn',
      );
    }
    const pointing = instructions.filter(({ state }) => state.status === 'synced');
    //? Everything already points at it: the checkbox turns them all off. Anything
    //? else turns on whatever can be turned on without losing content.
    if (instructionsStatus === 'synced') {
      return report(
        'unlink',
        'Unlinked',
        'AGENTS.md',
        pointing.map(({ ide: one, state }) => ({ ide: one, result: unlinkInstructions(state) })),
      );
    }
    const linkable = instructions.filter(
      ({ state }) =>
        state.status === 'missing' || (state.status === 'mismatch' && state.mode === 'import'),
    );
    const blocked = instructions.find(
      ({ state }) => state.status === 'mismatch' && state.mode === 'link',
    );
    report(
      'link',
      'Linked',
      'AGENTS.md',
      linkable.map(({ ide: one, state }) => ({ ide: one, result: linkInstructions(state) })),
    );
    if (blocked) {
      notify(
        `${relative(root, blocked.state.targetPath ?? '')} has content of its own — [p] replaces it with a link`,
        'warn',
      );
    }
  };

  const adoptableInstructions = instructions.find(
    ({ state }) => state.status === 'no-source' && state.targetHasContent,
  );
  const replaceableInstructions = instructions.filter(
    ({ state }) => state.status === 'mismatch' && state.mode === 'link',
  );

  const replaceInstructions = () =>
    prompt.confirm(
      `Replace ${replaceableInstructions.map(({ state }) => relative(root, state.targetPath ?? '')).join(', ')} with a link to AGENTS.md?`,
      () =>
        report(
          'replace',
          'Replaced',
          'IDE instructions with links to AGENTS.md',
          replaceableInstructions.map(({ ide: one, state }) => ({
            ide: one,
            result: linkInstructions(state, { force: true }),
          })),
        ),
    );

  const instructionsActions = (): ToolbarAction[] => {
    const actions: ToolbarAction[] = [];
    if (instructionsStatus === 'missing' || instructionsStatus === 'mismatch') {
      actions.push({
        hotkey: 'Space',
        label: 'Point every IDE at AGENTS.md',
        onPress: toggleInstructions,
        tone: 'primary',
      });
    }
    if (instructionsStatus === 'synced') {
      actions.push({ hotkey: 'Space', label: 'Remove the IDE files', onPress: toggleInstructions });
    }
    if (adoptableInstructions) {
      actions.push({
        hotkey: 'a',
        label: `Adopt ${relative(root, adoptableInstructions.state.targetPath ?? '')} as AGENTS.md`,
        onPress: () => apply(adoptInstructions(adoptableInstructions.state)),
        tone: 'primary',
      });
    }
    if (replaceableInstructions.length) {
      actions.push({
        hotkey: 'p',
        label: 'Replace with links',
        onPress: replaceInstructions,
        tone: 'danger',
      });
    }
    const exists = instructions[0]?.state.sourceExists;
    actions.push(
      { hotkey: 'v', label: 'Preview', onPress: togglePreview, isOn: preview },
      {
        hotkey: 'e',
        label: exists ? 'Edit AGENTS.md' : 'Write AGENTS.md',
        onPress: () => handoff({ type: 'edit', path: scope.instructionsPath }),
        tone: instructionsStatus === 'no-source' && !adoptableInstructions ? 'primary' : 'normal',
      },
    );
    return actions;
  };

  const instructionsRow: PickItem<MergedNode>[] =
    instructionsStatus === 'none'
      ? []
      : [
          {
            id: INSTRUCTIONS_ID,
            label: 'AGENTS.md',
            hint: INSTRUCTIONS_HINT[instructionsStatus],
            hintColor: instructionsStatus === 'synced' ? colors.accent : undefined,
            indent: TWISTY_CELLS,
            controls: [
              {
                id: 'link',
                glyph: INSTRUCTIONS_BOX[instructionsStatus],
                color:
                  instructionsStatus === 'synced' || instructionsStatus === 'native'
                    ? colors.ok
                    : instructionsStatus === 'mismatch'
                      ? colors.warn
                      : colors.muted,
                onPress: () => toggleInstructions(),
              },
            ],
          },
        ];

  const items = [...instructionsRow, ...toRows(merged)];
  const onInstructions = currentId === INSTRUCTIONS_ID;
  const current = items.find((item) => item.id === currentId)?.value;
  const currentOwn = current ? focusedOf(current) : undefined;
  const focusedInventory = currentOwn
    ? inventories.find((inventory) => current?.perIde[inventory.ide.id] === currentOwn)
    : focused;

  const diff = useLoader(
    () =>
      preview && currentOwn?.status === 'mismatch' && currentOwn.type === 'file'
        ? getNodeDiff(currentOwn)
        : undefined,
    [currentOwn?.relativePath, currentOwn?.status, focusedInventory?.ide.id, inventories, preview],
  );

  // --- entry actions -----------------------------------------------------

  const edit = (node: MergedNode) => {
    if (node.type !== 'file') return;
    const own = focusedOf(node);
    handoff({
      type: 'edit',
      path: node.status === 'orphan' && own?.targetPath ? own.targetPath : node.sourcePath,
    });
  };

  /** The IDE whose copy adopting takes: the header's, else the first that has one to give. */
  const adoptSource = (node: MergedNode) => {
    const wants = (own: AgentNode | undefined) =>
      own && (own.status === 'mismatch' || own.status === 'orphan' || own.status === 'implicit');
    const inventory =
      (wants(node.perIde[ide.id]) ? focused : undefined) ??
      inventories.find((one) => wants(node.perIde[one.ide.id]));
    return inventory ? { inventory, own: node.perIde[inventory.ide.id] as AgentNode } : undefined;
  };

  const adopt = (node: MergedNode) => {
    const from = adoptSource(node);
    if (!from)
      return notify('Nothing to adopt — only differing or IDE-only entries can be', 'warn');
    const overwrite = from.own.status === 'orphan' ? '' : ', overwriting it there';
    prompt.confirm(
      `Adopt ${from.inventory.ide.name}'s ${node.relativePath} into .agents${overwrite}?`,
      () => apply(syncNode(from.inventory, from.own, 'pull')),
    );
  };

  const differing = (node: MergedNode) =>
    inventories.filter((inventory) => {
      const own = node.perIde[inventory.ide.id];
      return own && (own.status === 'mismatch' || own.status === 'implicit');
    });

  const push = (node: MergedNode) => {
    const targets = differing(node);
    if (!targets.length) return notify('Nothing to push — no IDE copy differs', 'warn');
    prompt.confirm(
      `Push .agents/${node.relativePath} over ${targets.map((inventory) => inventory.ide.name).join(', ')}'s copy?`,
      () => report('push', 'Pushed', node.relativePath, pushEverywhere(inventories, node)),
    );
  };

  const remove = (node: MergedNode) => {
    if (node.status === 'orphan') {
      const own = focusedOf(node);
      const holder = inventories.find((inventory) => node.perIde[inventory.ide.id] === own);
      if (!own || !holder) return;
      return prompt.confirm(`Delete ${node.relativePath} from ${holder.ide.name} for good?`, () =>
        apply(deleteNode(own)),
      );
    }
    prompt.confirm(`Delete .agents/${node.relativePath} and every IDE's copy of it for good?`, () =>
      apply(deleteEverywhere(node)),
    );
  };

  const switchMode = () => {
    if (!focused?.canSwitchMode) return;
    const next = focused.mode === 'directory' ? 'granular' : 'directory';
    const folder = focused.ide.folder;
    const message =
      next === 'directory'
        ? `Replace ${folder} with one link to .agents?`
        : `Replace the ${folder} link with a folder of per-entry links?`;
    prompt.confirm(message, () => apply(setLinkMode(focused, next)));
  };

  const reveal = (node: MergedNode) => {
    const own = focusedOf(node);
    revealPath(
      (node.status === 'orphan' || node.status === 'synced') && own?.targetPath
        ? own.targetPath
        : node.sourcePath,
    );
  };

  /** The buttons for a row, the one it is most likely selected for marked primary. */
  const actionsFor = (node: MergedNode): ToolbarAction[] => {
    const isFile = node.type === 'file';
    const { status } = node;
    const actions: ToolbarAction[] = [];
    if (status === 'missing' || status === 'implicit' || status === 'synced') {
      actions.push({
        hotkey: 'Space',
        label: status === 'synced' ? 'Unlink everywhere' : 'Link everywhere',
        onPress: () => toggle(node),
        tone: status === 'synced' ? 'normal' : 'primary',
      });
    }
    if (differing(node).length) {
      actions.push({
        hotkey: 'p',
        label: 'Push .agents → IDEs',
        onPress: () => push(node),
        tone: status === 'mismatch' ? 'primary' : 'normal',
      });
    }
    const from = adoptSource(node);
    if (from) {
      actions.push({
        hotkey: 'a',
        label: `Adopt ${from.inventory.ide.name} → .agents`,
        onPress: () => adopt(node),
        tone: status === 'orphan' ? 'primary' : 'normal',
      });
    }
    if (isFile && status !== 'unused') {
      actions.push({
        hotkey: 'v',
        label: currentOwn?.status === 'mismatch' ? 'Diff' : 'Preview',
        onPress: togglePreview,
        isOn: preview,
        tone: status === 'synced' ? 'primary' : 'normal',
      });
    }
    if (isFile) actions.push({ hotkey: 'e', label: 'Edit', onPress: () => edit(node) });
    actions.push(
      { hotkey: 'o', label: 'Reveal', onPress: () => reveal(node) },
      { hotkey: 'x', label: 'Delete', onPress: () => remove(node), tone: 'danger' },
    );
    return actions;
  };

  useInput(
    (input, key) => {
      if (onInstructions) {
        if (input === ' ') toggleInstructions();
        else if (input === 'v') togglePreview();
        else if (input === 'e') handoff({ type: 'edit', path: scope.instructionsPath });
        else if (input === 'a' || input === 'p') {
          instructionsActions()
            .find((action) => action.hotkey === input)
            ?.onPress();
        }
        return;
      }
      if (input === 'm' && focused?.canSwitchMode) return switchMode();
      if (!current) return;
      const node = current;
      if (key.rightArrow || input === 'l') {
        if (node.type === 'directory') setOpen(node.relativePath, true);
      } else if (key.leftArrow || input === 'h') {
        if (node.type === 'directory') setOpen(node.relativePath, false);
      } else if (input === ' ') toggle(node);
      else if (input === 'a') adopt(node);
      else if (input === 'p') push(node);
      else if (input === 'v') togglePreview();
      else if (input === 'e') edit(node);
      else if (input === 'x') remove(node);
      else if (input === 'o') reveal(node);
    },
    { isActive: !prompt.isOpen },
  );

  const hints: Hint[] = [
    { key: '←/→', label: 'fold' },
    { key: 'Space', label: 'link everywhere' },
    { key: 'v', label: 'preview', onPress: togglePreview },
    ...(ides.length > 1 ? [{ key: '[ ]', label: `preview/adopt from ${ide.name}` }] : []),
    ...(focused?.canSwitchMode
      ? [{ key: 'm', label: `${focused.ide.name} mode: ${focused.mode}`, onPress: switchMode }]
      : []),
  ];

  const header =
    prompt.line ??
    (inventories.length ? (
      <Text wrap="truncate" color={colors.muted}>
        {scope.kind === 'user' ? '~/.agents' : '.agents'} →{' '}
        {inventories
          .map((inventory) =>
            inventory.targets.length
              ? `${inventory.ide.name} (${summary(inventory)})`
              : `${inventory.ide.name} (keeps no files here)`,
          )
          .join(' · ')}
      </Text>
    ) : (
      <Text color={colors.muted}>{error ?? 'Reading .agents…'}</Text>
    ));

  //? Rows the detail pane can give a preview: everything the chrome leaves,
  //? less the toolbar, the status line and one line per IDE drawn above it
  const previewRows = Math.max(
    3,
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) -
      6 -
      ides.length,
  );

  const previewLines = (body: string, diffing: boolean) => (
    <Box flexDirection="column" marginTop={1}>
      {body
        .split('\n')
        .slice(0, previewRows)
        .map((line, index) => (
          <Text
            key={index}
            wrap="truncate"
            color={
              !diffing
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
  );

  const renderInstructions = () => (
    <Box flexDirection="column">
      <Toolbar actions={instructionsActions()} />
      <Text color={colors.muted} wrap="truncate">
        source {relative(root, scope.instructionsPath)}
        {instructions[0]?.state.sourceExists ? '' : ' (not written yet)'}
      </Text>
      {instructions.map(({ ide: one, state }) => (
        <Text key={one.id} wrap="truncate">
          <Text color={one.id === ide.id ? colors.accent : colors.muted}>
            {one.name.padEnd(13)}
          </Text>
          <Text
            color={
              state.status === 'synced' || state.status === 'native'
                ? colors.ok
                : state.status === 'mismatch'
                  ? colors.warn
                  : colors.muted
            }
          >
            {INSTRUCTIONS_HINT[state.status] || state.status}
          </Text>
          <Text color={colors.muted}>
            {state.targetPath
              ? `  ${relative(root, state.targetPath)} (${state.mode === 'import' ? 'imports it' : 'links to it'})`
              : ''}
          </Text>
        </Text>
      ))}
      {preview && previewLines(readPreview(scope.instructionsPath), false)}
    </Box>
  );

  const renderDetail = (item: PickItem<MergedNode> | undefined) => {
    if (item?.id === INSTRUCTIONS_ID) return renderInstructions();
    const node = item?.value;
    if (!node) return null;
    const own = focusedOf(node);
    const diffing = own?.status === 'mismatch';
    const body =
      node.type !== 'file' || !preview || !own
        ? undefined
        : diffing
          ? //? From the first hunk: git's header repeats both absolute paths, which
            //? the lines above already show, and costs four rows to say it
            (diff.data?.slice(Math.max(0, diff.data.indexOf('@@'))) ??
            (diff.isLoading ? 'Diffing…' : 'No textual difference.'))
          : readPreview(
              node.status === 'orphan' && own.targetPath ? own.targetPath : node.sourcePath,
            );

    return (
      <Box flexDirection="column">
        <Toolbar actions={actionsFor(node)} />
        <Text color={statusColor(node.status, colors)} wrap="truncate">
          {CHECKBOX[node.status]} {DESCRIBE[node.status]}
        </Text>
        {ides.map((one) => {
          const mine = node.perIde[one.id];
          return (
            <Text key={one.id} wrap="truncate">
              <Text color={one.id === ide.id ? colors.accent : colors.muted}>
                {one.name.padEnd(13)}
              </Text>
              <Text color={mine ? statusColor(mine.status, colors) : colors.muted}>
                {mine ? hintFor(mine) : 'nothing here'}
              </Text>
              <Text color={colors.muted}>
                {mine?.targetPath ? `  ${relative(root, mine.targetPath)}` : ''}
                {mine?.linkTarget ? ` → ${mine.linkTarget}` : ''}
              </Text>
            </Text>
          );
        })}
        {node.type === 'file' && !preview && own && (
          <Box marginTop={1}>
            <Text color={colors.muted}>
              [v] {diffing ? `shows ${ide.name}'s diff` : 'shows the file'} here
            </Text>
          </Box>
        )}
        {body !== undefined && previewLines(body, diffing)}
      </Box>
    );
  };

  const emptyText = !inventories.length
    ? isLoading
      ? 'Reading…'
      : (error ?? 'Nothing to show.')
    : focused?.hasSource
      ? '.agents is empty.'
      : 'No .agents folder here, and nothing in the IDEs to adopt into one.';

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={
          focused?.hasSource === false ? '.agents (not created yet)' : `.agents (${items.length})`
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
          if (node.type === 'directory')
            setOpen(node.relativePath, !expanded.has(node.relativePath));
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

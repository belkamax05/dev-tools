import { join } from 'node:path';
import { Text, useInput } from 'ink';
import { useEffect, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import revealPath from '@/dev-tools/utils/system/revealPath';

import { commit, isHeadPushed } from '../../../../core/commit';
import {
  discardHunk,
  getDiff,
  parseDiff,
  reapplyPatch,
  stageHunk,
  unstageHunk,
} from '../../../../core/hunks';
import { resolveFile } from '../../../../core/operation';
import {
  discard,
  type FileChange,
  getChanges,
  type OperationResult,
  stage,
  stageAll,
  undoDiscard,
  unstage,
} from '../../../../core/status';
import DiffLines from '../../DiffLines';
import type { GitViewProps } from '../../types';

type Side = 'conflict' | 'staged' | 'unstaged';

interface Row {
  change: FileChange;
  side: Side;
}

/** What git's status letter means, in the word a list has room for. */
const WORDS: Record<string, string> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type changed',
};

const hintFor = ({ change, side }: Row) =>
  side === 'conflict'
    ? 'conflict'
    : change.untracked
      ? 'new'
      : (WORDS[side === 'staged' ? change.index : change.work] ?? 'changed');

/**
 * The working tree as a staging area.
 *
 * Every file is a row with a checkbox — ticked when staged — and the diff of
 * that side (what staging it would add, or what is already staged) in the
 * detail pane, walked hunk by hunk. Stage, unstage or throw away a whole file
 * or one hunk; commit from the same screen. Discards are confirmed and can be
 * undone from the status line straight after.
 */
export const StatusView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  handoff,
  offerUndo,
  reservedChrome,
}: GitViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [hunk, setHunk] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data: changes = [], isLoading } = useLoader(() => getChanges(root), [root, refreshKey]);

  const rows: Row[] = [
    ...changes.filter((c) => c.conflicted).map((change) => ({ change, side: 'conflict' as const })),
    ...changes.filter((c) => c.staged).map((change) => ({ change, side: 'staged' as const })),
    ...changes.filter((c) => c.unstaged).map((change) => ({ change, side: 'unstaged' as const })),
  ];
  const idOf = (row: Row) => `${row.side}:${row.change.path}`;
  const current = rows.find((row) => idOf(row) === currentId);

  //? A different file starts at its first hunk
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection is the trigger
  useEffect(() => setHunk(0), [currentId]);

  const { data: diffText = '' } = useLoader(
    () =>
      current && current.side !== 'conflict'
        ? getDiff(root, current.change.path, current.change.untracked ? 'untracked' : current.side)
        : Promise.resolve(''),
    [currentId, refreshKey],
  );
  const diff = parseDiff(diffText);
  const activeHunk = Math.min(hunk, Math.max(0, diff.hunks.length - 1));

  const run = async (action: () => Promise<OperationResult>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await action();
      notify(result.message, result.ok ? 'ok' : 'error');
    } finally {
      setBusy(false);
      reload();
    }
  };

  const toggle = (row: Row) => {
    if (row.side === 'conflict') {
      return prompt.confirm(`Mark ${row.change.path} resolved, as it stands now?`, () =>
        run(() => resolveFile(root, row.change.path, 'mark')),
      );
    }
    run(() =>
      row.side === 'staged' ? unstage(root, [row.change.path]) : stage(root, [row.change.path]),
    );
  };

  const discardFile = (row: Row) => {
    if (row.side !== 'unstaged')
      return notify('Only unstaged changes are discarded — unstage it first', 'warn');
    prompt.confirm(
      `Discard ${row.change.untracked ? 'the new file' : 'the changes to'} ${row.change.path}?`,
      () =>
        run(async () => {
          const result = await discard(root, [row.change]);
          const undo = result.undo;
          if (undo)
            offerUndo({ label: `Discarded ${undo.label}`, run: () => undoDiscard(root, undo) });
          return result;
        }),
    );
  };

  const hunkAction = (kind: 'stage' | 'discard') => {
    if (!current || current.side === 'conflict' || current.change.untracked) {
      return notify(
        current?.change.untracked ? 'A new file is staged whole' : 'No hunk here',
        'warn',
      );
    }
    if (kind === 'stage') {
      return run(() =>
        current.side === 'staged'
          ? unstageHunk(root, diff, activeHunk)
          : stageHunk(root, diff, activeHunk),
      );
    }
    if (current.side !== 'unstaged') return notify('Only unstaged hunks are discarded', 'warn');
    prompt.confirm(`Discard hunk ${activeHunk + 1} of ${current.change.path}?`, () =>
      run(async () => {
        const result = await discardHunk(root, diff, activeHunk);
        const patch = result.patch;
        if (patch) offerUndo({ label: 'Discarded a hunk', run: () => reapplyPatch(root, patch) });
        return result;
      }),
    );
  };

  const commitWith = () =>
    prompt.ask('Commit message:', (message) => {
      if (message.trim()) void run(() => commit(root, message));
    });

  const amend = async () => {
    const pushed = await isHeadPushed(root);
    prompt.confirm(
      pushed
        ? 'HEAD is already pushed — amending rewrites shared history. Amend anyway?'
        : 'Fold the staged changes into the last commit, keeping its message?',
      () => run(() => commit(root, '', { amend: true })),
    );
  };

  const wip = () =>
    run(async () => {
      const staged = await stageAll(root);
      return staged.ok ? commit(root, 'wip') : staged;
    });

  const unstageAll = () =>
    run(() =>
      unstage(
        root,
        changes.filter((c) => c.staged).map((c) => c.path),
      ),
    );

  useInput(
    (input) => {
      if (busy) return;
      if (input === 'a') return run(() => stageAll(root));
      if (input === 'A') return unstageAll();
      if (input === 'c') return commitWith();
      if (input === 'C')
        return handoff({ type: 'run', command: ['git', 'commit'], cwd: root, label: 'git commit' });
      if (input === 'M') return void amend();
      if (input === 'W') return wip();
      if (!current) return;
      if (input === ' ') toggle(current);
      else if (input === 'n') setHunk((at) => Math.min(at + 1, Math.max(0, diff.hunks.length - 1)));
      else if (input === 'N') setHunk((at) => Math.max(0, at - 1));
      else if (input === 's') hunkAction('stage');
      else if (input === 'd') hunkAction('discard');
      else if (input === 'x') discardFile(current);
      else if (input === 'e') handoff({ type: 'edit', path: join(root, current.change.path) });
      else if (input === 'o') revealPath(join(root, current.change.path));
      else if (current.side === 'conflict' && (input === 'O' || input === 'T')) {
        const side = input === 'O' ? 'ours' : 'theirs';
        prompt.confirm(`Take ${side} for all of ${current.change.path}?`, () =>
          run(() => resolveFile(root, current.change.path, side)),
        );
      }
    },
    { isActive: !prompt.isOpen },
  );

  const counts = {
    conflict: rows.filter((r) => r.side === 'conflict').length,
    staged: rows.filter((r) => r.side === 'staged').length,
    unstaged: rows.filter((r) => r.side === 'unstaged').length,
  };

  const items: PickItem<Row>[] = (
    [
      ['conflict', 'Conflicts'],
      ['staged', 'Staged'],
      ['unstaged', 'Changes'],
    ] as const
  ).flatMap(([side, title]) => {
    const group = rows.filter((row) => row.side === side);
    if (!group.length) return [];
    return [
      { id: `header-${side}`, label: `${title} (${group.length})`, isHeader: true },
      ...group.map(
        (row): PickItem<Row> => ({
          id: idOf(row),
          label: row.change.origPath
            ? `${row.change.origPath} → ${row.change.path}`
            : row.change.path,
          hint: hintFor(row),
          hintColor: side === 'conflict' ? colors.error : side === 'staged' ? colors.ok : undefined,
          value: row,
          controls: [
            {
              id: 'stage',
              glyph: side === 'conflict' ? '[!]' : side === 'staged' ? '[x]' : '[ ]',
              color:
                side === 'conflict' ? colors.error : side === 'staged' ? colors.ok : colors.muted,
              onPress: () => toggle(row),
            },
          ],
        }),
      ),
    ];
  });

  const actionsFor = (row: Row): ToolbarAction[] => {
    if (row.side === 'conflict') {
      return [
        {
          hotkey: 'e',
          label: 'Edit to resolve',
          onPress: () => handoff({ type: 'edit', path: join(root, row.change.path) }),
          tone: 'primary',
        },
        { hotkey: 'Space', label: 'Mark resolved', onPress: () => toggle(row) },
        {
          hotkey: 'O',
          label: 'Take ours',
          onPress: () =>
            prompt.confirm(`Take ours for ${row.change.path}?`, () =>
              run(() => resolveFile(root, row.change.path, 'ours')),
            ),
        },
        {
          hotkey: 'T',
          label: 'Take theirs',
          onPress: () =>
            prompt.confirm(`Take theirs for ${row.change.path}?`, () =>
              run(() => resolveFile(root, row.change.path, 'theirs')),
            ),
        },
      ];
    }
    const staged = row.side === 'staged';
    const hunks = !row.change.untracked && diff.hunks.length > 1;
    return [
      {
        hotkey: 'Space',
        label: staged ? 'Unstage' : 'Stage',
        onPress: () => toggle(row),
        tone: 'primary',
      },
      ...(hunks
        ? [
            {
              hotkey: 's',
              label: `${staged ? 'Unstage' : 'Stage'} hunk ${activeHunk + 1}/${diff.hunks.length}`,
              onPress: () => hunkAction('stage'),
            },
            {
              hotkey: 'n',
              label: 'Next hunk',
              onPress: () => setHunk((at) => Math.min(at + 1, diff.hunks.length - 1)),
            },
          ]
        : []),
      ...(!staged
        ? [
            ...(hunks
              ? [
                  {
                    hotkey: 'd',
                    label: 'Discard hunk',
                    onPress: () => hunkAction('discard'),
                    tone: 'danger' as const,
                  },
                ]
              : []),
            {
              hotkey: 'x',
              label: 'Discard file',
              onPress: () => discardFile(row),
              tone: 'danger' as const,
            },
          ]
        : []),
      {
        hotkey: 'e',
        label: 'Edit',
        onPress: () => handoff({ type: 'edit', path: join(root, row.change.path) }),
      },
    ];
  };

  const hints: Hint[] = [
    { key: 'a', label: 'stage all', onPress: () => void run(() => stageAll(root)) },
    ...(counts.staged ? [{ key: 'A', label: 'unstage all', onPress: unstageAll }] : []),
    {
      key: 'c',
      label: counts.staged ? `commit ${counts.staged}` : 'commit',
      onPress: counts.staged ? commitWith : undefined,
    },
    {
      key: 'C',
      label: 'in editor',
      onPress: () =>
        handoff({ type: 'run', command: ['git', 'commit'], cwd: root, label: 'git commit' }),
    },
    { key: 'M', label: 'amend', onPress: () => void amend() },
    { key: 'W', label: 'wip' },
  ];

  const header = prompt.line ?? (
    <Text wrap="truncate" color={colors.muted}>
      {isLoading && !changes.length
        ? 'Reading the working tree…'
        : rows.length
          ? `${counts.conflict ? `${counts.conflict} conflicted · ` : ''}${counts.staged} staged · ${counts.unstaged} changed${busy ? ' · working…' : ''}`
          : 'Working tree clean'}
    </Text>
  );

  const diffRows = Math.max(
    3,
    viewport.contentRows(
      ['appShell', 'viewHints', 'panelFrame', 'viewHeader', ...reservedChrome],
      3,
    ) - 4,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={`Status (${rows.length})`}
        items={items}
        emptyText="Nothing to commit — the working tree is clean."
        detailTitle={
          current ? `${current.change.path}${current.side === 'staged' ? ' (staged)' : ''}` : 'Diff'
        }
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="stage / unstage"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={(item) => item.value && toggle(item.value)}
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return <Text color={colors.ok}>Working tree clean.</Text>;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(row)} />
              {row.side === 'conflict' ? (
                <Text color={colors.text}>
                  Both sides changed this file. Edit it to keep what you want and mark it resolved,
                  or take one side whole.
                </Text>
              ) : (
                <DiffLines diff={diff} activeHunk={activeHunk} rows={diffRows} />
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default StatusView;

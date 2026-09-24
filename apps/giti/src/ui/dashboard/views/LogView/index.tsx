import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  branchAt,
  checkoutDetached,
  cherryPick,
  type Commit,
  getCommitDetail,
  getCommitDiff,
  getLog,
  revertCommit,
} from '../../../../core/log';
import type { OperationResult } from '../../../../core/status';
import copyToClipboard from '../../clipboard';
import PatchLines from '../../PatchLines';
import type { GitViewProps } from '../../types';

/** Commits read per page; another page is read when the cursor nears the end. */
const PAGE = 100;

/**
 * History, newest first, with the commit under the cursor in full beside it.
 *
 * Reads a page at a time and the next one as the cursor gets near the end, so
 * a long history costs nothing until it is scrolled. `g` draws the branch
 * graph; `v` swaps the commit's summary for its diff. The actions that change
 * the working tree or history — checkout, cherry-pick, revert — ask first.
 */
export const LogView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  reservedChrome,
}: GitViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [pages, setPages] = useState(1);
  const [graph, setGraph] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);

  const { data: lines = [], isLoading } = useLoader(
    () => getLog(root, { limit: PAGE * pages, graph }),
    [root, refreshKey, pages, graph],
  );
  const commits = lines.filter(
    (line): line is Commit & { kind: 'commit' } => line.kind === 'commit',
  );
  const current = commits.find((c) => c.hash === currentId);

  const { data: detail } = useLoader(
    () => (current ? getCommitDetail(root, current.hash) : Promise.resolve(undefined)),
    [current?.hash],
  );
  const { data: diff = '' } = useLoader(
    () => (current && showDiff ? getCommitDiff(root, current.hash) : Promise.resolve('')),
    [current?.hash, showDiff],
  );

  const run = async (action: () => Promise<OperationResult>) => {
    const result = await action();
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const copy = (commit: Commit) => {
    copyToClipboard(commit.hash);
    notify(`Copied ${commit.short} to the clipboard`, 'ok');
  };
  const branchHere = (commit: Commit) =>
    prompt.ask(`New branch at ${commit.short}:`, (name) => {
      if (name.trim()) void run(() => branchAt(root, name, commit.hash));
    });
  const checkout = (commit: Commit) =>
    prompt.confirm(`Check out ${commit.short} (detached HEAD)?`, () =>
      run(() => checkoutDetached(root, commit.hash)),
    );
  const pick = (commit: Commit) =>
    prompt.confirm(`Cherry-pick ${commit.short} onto the current branch?`, () =>
      run(() => cherryPick(root, commit.hash)),
    );
  const revert = (commit: Commit) =>
    prompt.confirm(`Revert ${commit.short} with a new commit?`, () =>
      run(() => revertCommit(root, commit.hash)),
    );

  useInput(
    (input) => {
      if (input === 'g') return setGraph((on) => !on);
      if (!current) return;
      if (input === 'v') setShowDiff((on) => !on);
      else if (input === 'y') copy(current);
      else if (input === 'b') branchHere(current);
      else if (input === 'k') checkout(current);
      else if (input === 'p') pick(current);
      else if (input === 'R') revert(current);
    },
    { isActive: !prompt.isOpen },
  );

  const items: PickItem<Commit>[] = lines.map((line, index) =>
    line.kind === 'graph'
      ? { id: `graph-${index}`, label: line.graph, disabled: true }
      : {
          id: line.hash,
          label: `${line.graph}${line.short} ${line.refs ? `(${line.refs}) ` : ''}${line.subject}`,
          hint: `${line.author.split(' ')[0]}, ${line.when}`,
          hintColor: line.refs.includes('HEAD') ? colors.accent : undefined,
          value: line,
        },
  );

  const actionsFor = (commit: Commit): ToolbarAction[] => [
    {
      hotkey: 'v',
      label: 'Diff',
      onPress: () => setShowDiff((on) => !on),
      isOn: showDiff,
      tone: 'primary',
    },
    { hotkey: 'y', label: 'Copy hash', onPress: () => copy(commit) },
    { hotkey: 'b', label: 'Branch here', onPress: () => branchHere(commit) },
    { hotkey: 'k', label: 'Checkout', onPress: () => checkout(commit) },
    { hotkey: 'p', label: 'Cherry-pick', onPress: () => pick(commit) },
    { hotkey: 'R', label: 'Revert', onPress: () => revert(commit), tone: 'danger' },
  ];

  const hints: Hint[] = [
    { key: 'g', label: graph ? 'graph: on' : 'graph: off', onPress: () => setGraph((on) => !on) },
  ];

  const rows = Math.max(
    3,
    viewport.contentRows(
      ['appShell', 'viewHints', 'panelFrame', 'viewHeader', ...reservedChrome],
      3,
    ) - 4,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text wrap="truncate" color={colors.muted}>
            {isLoading && !commits.length
              ? 'Reading history…'
              : `${commits.length} commits read${commits.length >= PAGE * pages ? ' — more load as you scroll' : ''}`}
          </Text>
        )}
      </Box>
      <ListDetail
        title={`Log (${commits.length})`}
        items={items}
        emptyText="No commits yet."
        detailTitle={current ? current.short : 'Commit'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="diff"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        hints={hints}
        onActivate={() => setShowDiff((on) => !on)}
        onSelectionChange={(item, index) => {
          setCurrentId(item?.id);
          //? Near the end of what is loaded, and there may be more: read the next page
          if (index > items.length - 10 && commits.length >= PAGE * pages) setPages((n) => n + 1);
        }}
        renderDetail={(item) => {
          const commit = item?.value;
          if (!commit) return null;
          return (
            <Box flexDirection="column">
              <Toolbar actions={actionsFor(commit)} />
              {showDiff ? (
                <PatchLines text={diff} rows={rows} />
              ) : (
                <Box flexDirection="column">
                  <Text bold color={colors.text} wrap="truncate">
                    {detail?.subject ?? commit.subject}
                  </Text>
                  <Text color={colors.muted} wrap="truncate">
                    {detail?.author ?? commit.author} · {detail?.date ?? commit.when}
                  </Text>
                  <Text color={colors.muted} wrap="truncate">
                    {commit.hash}
                  </Text>
                  {detail?.body ? (
                    <Box marginTop={1}>
                      <Text color={colors.text}>{detail.body}</Text>
                    </Box>
                  ) : null}
                  <Box flexDirection="column" marginTop={1}>
                    {(detail?.stat ?? []).slice(0, Math.max(1, rows - 6)).map((line, index) => (
                      <Text key={index} color={colors.muted} wrap="truncate">
                        {line}
                      </Text>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default LogView;

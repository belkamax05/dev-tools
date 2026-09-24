import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  applyStash,
  dropStash,
  getStashDiff,
  getStashes,
  popStash,
  pushStash,
  restoreStash,
  type StashEntry,
} from '../../../../core/stash';
import type { OperationResult } from '../../../../core/status';
import PatchLines from '../../PatchLines';
import type { GitViewProps } from '../../types';

/**
 * Stashes, each with its diff: put the working tree aside (`s`), bring one
 * back (`p` pop, `a` apply and keep it), or drop it — undoable straight after.
 */
export const StashView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  offerUndo,
  reservedChrome,
}: GitViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);

  const { data: stashes = [], isLoading } = useLoader(() => getStashes(root), [root, refreshKey]);
  const current = stashes.find((s) => s.ref === currentId);
  const { data: diff = '' } = useLoader(
    () => (current ? getStashDiff(root, current.ref) : Promise.resolve('')),
    [current?.ref, refreshKey],
  );

  const run = async (action: () => Promise<OperationResult>) => {
    const result = await action();
    notify(result.message, result.ok ? 'ok' : 'error');
    reload();
  };

  const stashNow = () =>
    prompt.ask('Stash your changes as:', (message) => void run(() => pushStash(root, message)));
  const drop = (entry: StashEntry) =>
    prompt.confirm(`Drop ${entry.ref} (${entry.message})?`, () =>
      run(async () => {
        const result = await dropStash(root, entry);
        const hash = result.hash;
        if (hash)
          offerUndo({
            label: `Dropped ${entry.ref}`,
            run: () => restoreStash(root, hash, entry.message),
          });
        return result;
      }),
    );

  useInput(
    (input) => {
      if (input === 's') return stashNow();
      if (!current) return;
      if (input === 'p') void run(() => popStash(root, current.ref));
      else if (input === 'a') void run(() => applyStash(root, current.ref));
      else if (input === 'x') drop(current);
    },
    { isActive: !prompt.isOpen },
  );

  const items: PickItem<StashEntry>[] = stashes.map((entry) => ({
    id: entry.ref,
    label: entry.message,
    hint: entry.when,
    value: entry,
  }));

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
            {isLoading && !stashes.length
              ? 'Reading stashes…'
              : `${stashes.length} stash(es) · [s] stashes the working tree`}
          </Text>
        )}
      </Box>
      <ListDetail
        title={`Stash (${stashes.length})`}
        items={items}
        emptyText="No stashes — [s] puts your current changes aside."
        detailTitle={current?.ref ?? 'Stash'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="pop"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        hints={[{ key: 's', label: 'stash now', onPress: stashNow }]}
        onActivate={(item) =>
          item.value && void run(() => popStash(root, (item.value as StashEntry).ref))
        }
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const entry = item?.value;
          if (!entry) return null;
          return (
            <Box flexDirection="column">
              <Toolbar
                actions={[
                  {
                    hotkey: 'p',
                    label: 'Pop',
                    onPress: () => void run(() => popStash(root, entry.ref)),
                    tone: 'primary',
                  },
                  {
                    hotkey: 'a',
                    label: 'Apply, keep it',
                    onPress: () => void run(() => applyStash(root, entry.ref)),
                  },
                  { hotkey: 'x', label: 'Drop', onPress: () => drop(entry), tone: 'danger' },
                ]}
              />
              <PatchLines text={diff} rows={rows} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default StashView;

import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl, { remoteWebUrl } from '@/dev-tools/utils/system/openUrl';

import { getBranches } from '../../../../core/branches';
import {
  getRemotes,
  pushCurrent,
  type Remote,
  removeRemote,
  restoreRemote,
} from '../../../../core/remotes';
import type { OperationResult } from '../../../../core/status';
import type { GitViewProps } from '../../types';
import SpinnerGlyph from '../../SpinnerGlyph';
import type { RemoteSync } from '../../useRemoteSync';

export interface RemotesViewProps extends GitViewProps {
  /** Fetch and pull, shared with Overview so the vendored count and progress are one state. */
  sync: RemoteSync;
}

/**
 * Remotes, and the three things done with them — fetch, pull, push — with
 * git's own progress shown live while they run. The button the branch most
 * likely needs is the highlighted one: push when ahead, pull when behind.
 * Force-pushing exists only as `--force-with-lease`, and asks first.
 * Removing a remote asks first too, and can be undone (^Z) — settings,
 * tracking refs and the upstream of every branch that followed it included.
 */
export const RemotesView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  offerUndo,
  reservedChrome,
  sync,
}: RemotesViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const viewport = useViewport();
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [ownProgress, setProgress] = useState<string | undefined>(undefined);
  const progress = sync.progress ?? ownProgress;

  const { data } = useLoader(
    async () => ({ remotes: await getRemotes(root), branches: await getBranches(root) }),
    [root, refreshKey],
  );
  const remotes = data?.remotes ?? [];
  const branch = data?.branches.find((b) => b.isCurrent);
  const current = remotes.find((r) => r.name === currentId);

  const run = async (
    label: string,
    action: (onProgress: (line: string) => void) => Promise<OperationResult>,
  ) => {
    if (progress) return;
    setProgress(`${label}…`);
    try {
      const result = await action((line) => setProgress(`${label}: ${line}`));
      notify(result.message, result.ok ? 'ok' : 'error');
    } finally {
      setProgress(undefined);
      reload();
    }
  };

  const fetch = () => {
    if (!progress) sync.fetch();
  };
  const pull = () => {
    if (!progress) sync.pull();
  };
  const push = (remote = current?.name ?? 'origin') =>
    void run('Pushing', (onProgress) => pushCurrent(root, { remote, onProgress }));
  const forcePush = () =>
    prompt.confirm(
      `Force-push ${branch?.name ?? 'this branch'} (with lease — refused if the remote moved)?`,
      () =>
        run('Force-pushing', (onProgress) =>
          pushCurrent(root, { remote: current?.name ?? 'origin', force: true, onProgress }),
        ),
    );

  const remove = (remote = current) => {
    if (!remote) return;
    prompt.confirm(
      `Remove remote ${remote.name}? Its tracking branches go too, and branches following it lose their upstream (^Z undoes it).`,
      () =>
        run(`Removing ${remote.name}`, async () => {
          const result = await removeRemote(root, remote.name);
          const undo = result.undo;
          if (undo) {
            offerUndo({ label: `Removed remote ${undo.name}`, run: () => restoreRemote(root, undo) });
          }
          return result;
        }),
    );
  };

  useInput(
    (input) => {
      if (input === 'f') fetch();
      else if (input === 'x') remove();
      else if (input === 'l') pull();
      else if (input === 'P') push();
      else if (input === 'F') forcePush();
      else if (input === 'o' && current) {
        const url = remoteWebUrl(current.fetchUrl);
        if (url) openUrl(url);
        else notify(`${current.name} has no web page`, 'warn');
      }
    },
    { isActive: !prompt.isOpen },
  );

  const ahead = branch?.ahead ?? 0;
  const behind = branch?.behind ?? 0;
  //? A mega pull brings in the vendored directories too, so their waiting commits count here
  const incoming = behind + sync.vendoredBehind;
  const actions: ToolbarAction[] = [
    {
      hotkey: 'f',
      label: 'Fetch',
      onPress: fetch,
      tone: !ahead && !incoming ? 'primary' : 'normal',
      disabled: Boolean(progress),
    },
    {
      hotkey: 'l',
      label: incoming ? `Pull ↓${incoming}` : 'Pull',
      onPress: pull,
      tone: incoming ? 'primary' : 'normal',
      disabled: Boolean(progress),
    },
    {
      hotkey: 'P',
      label: ahead ? `Push ↑${ahead}` : 'Push',
      onPress: () => push(),
      tone: ahead && !behind ? 'primary' : 'normal',
      disabled: Boolean(progress),
    },
    {
      hotkey: 'F',
      label: 'Force push',
      onPress: forcePush,
      tone: 'danger',
      disabled: Boolean(progress),
    },
  ];

  const items: PickItem<Remote>[] = remotes.map((remote) => ({
    id: remote.name,
    label: remote.name,
    //? The address shortened to what tells remotes apart — its last two parts
    hint: remote.fetchUrl
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .filter(Boolean)
      .slice(-2)
      .join('/'),
    value: remote,
  }));

  //? Detail-pane rows, measured the way BranchesView does, less the three URL lines under the
  //? buttons — what is left is how many buttons can be stacked one per line.
  const toolbarRows =
    viewport.contentRows(
      ['appShell', 'viewHints', 'panelFrame', 'viewHeader', ...reservedChrome],
      3,
    ) - 4;

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text wrap="truncate" color={progress ? colors.accent : colors.muted}>
            {progress && <SpinnerGlyph />}
            {progress ??
              (branch
                ? `${branch.name} → ${branch.upstream || 'no upstream (a push sets one)'} · ${ahead} ahead, ${behind} behind`
                : 'Detached HEAD')}
          </Text>
        )}
      </Box>
      <ListDetail
        title={`Remotes (${remotes.length})`}
        items={items}
        emptyText="No remotes — add one with git remote add."
        detailTitle={current?.name ?? 'Remote'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="open in browser"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: 'f', label: 'fetch', onPress: fetch },
          { key: 'l', label: 'pull', onPress: pull },
          { key: 'P', label: 'push', onPress: () => push() },
          ...(current ? [{ key: 'x', label: `remove ${current.name}`, onPress: () => remove() }] : []),
        ]}
        onActivate={(item) => {
          const url = item.value && remoteWebUrl(item.value.fetchUrl);
          if (url) openUrl(url);
        }}
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const remote = item?.value;
          if (!remote) return <Toolbar actions={actions} maxRows={toolbarRows + 3} />;
          const url = remoteWebUrl(remote.fetchUrl);
          return (
            <Box flexDirection="column">
              <Toolbar
                maxRows={toolbarRows}
                actions={[
                  ...actions,
                  {
                    hotkey: 'x',
                    label: 'Remove',
                    onPress: () => remove(remote),
                    tone: 'danger',
                    disabled: Boolean(progress),
                  },
                ]}
              />
              <LinkRow label="fetch" value={remote.fetchUrl} />
              <LinkRow label="push" value={remote.pushUrl || remote.fetchUrl} />
              <LinkRow
                label="web"
                value={url ?? '—'}
                onOpen={url ? () => openUrl(url) : undefined}
              />
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default RemotesView;

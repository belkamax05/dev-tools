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
import type { RepoSnapshot } from '../../../../utils/getRepoSnapshot';
import type { Vendored } from '../../../../utils/vendored';
import type { GitViewProps } from '../../types';
import VendoredDetail from '../../VendoredDetail';
import SpinnerGlyph from '../../SpinnerGlyph';
import type { RemoteSync } from '../../useRemoteSync';

export interface RemotesViewProps extends GitViewProps {
  /** Fetch and pull, shared with Overview so the vendored count and progress are one state. */
  sync: RemoteSync;
  /** For its vendored directories — listed here, under the remotes they are also synced with. */
  snapshot: RepoSnapshot;
  /** Run a giti command on the real terminal — `mega/push` and `mega/status` print their own. */
  onRunCommand: (command: string) => void;
}

/** A row of the list: one of the repository's remotes, or one of its vendored directories. */
type Row = { kind: 'remote'; remote: Remote } | { kind: 'vendored'; entry: Vendored };

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
  snapshot,
  onRunCommand,
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
  const vendored = snapshot.vendored;
  const current = remotes.find((r) => `remote:${r.name}` === currentId);
  const currentVendored = vendored.find((v) => `vendored:${v.kind}:${v.dir}` === currentId);

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
    (input, key) => {
      //? Ctrl+P / Ctrl+X arrive as 'p' / 'x' too; they belong to the palette and the op banner
      if (key.ctrl) return;
      if (input === 'f') fetch();
      else if (input === 'x') remove();
      else if (input === 'p') pull();
      //? On a vendored row, push means every vendored directory — what mega/push does
      else if (input === 'P') currentVendored ? onRunCommand('mega/push') : push();
      else if (input === 'S') onRunCommand('mega/status');
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
      hotkey: 'p',
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

  const remoteItems: PickItem<Row>[] = remotes.map((remote) => ({
    id: `remote:${remote.name}`,
    label: remote.name,
    //? The address shortened to what tells remotes apart — its last two parts
    hint: remote.fetchUrl
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .filter(Boolean)
      .slice(-2)
      .join('/'),
    value: { kind: 'remote', remote },
  }));
  const vendoredItems: PickItem<Row>[] = vendored.map((entry) => ({
    id: `vendored:${entry.kind}:${entry.dir}`,
    label: entry.dir,
    hint: entry.kind,
    value: { kind: 'vendored', entry },
  }));
  const items: PickItem<Row>[] = [
    ...(remoteItems.length
      ? [
          { id: 'header-remotes', label: `Remotes (${remotes.length})`, isHeader: true },
          ...remoteItems,
        ]
      : []),
    ...(vendoredItems.length
      ? [
          { id: 'header-vendored', label: `Vendored (${vendored.length})`, isHeader: true },
          ...vendoredItems,
        ]
      : []),
  ];
  //? Pull already covers them (mega pull); push and status go to the mega commands, which print
  //? a report per directory and so run on the real terminal
  const vendoredActions: ToolbarAction[] = [
    actions[1] as ToolbarAction,
    { hotkey: 'P', label: 'Push all', onPress: () => onRunCommand('mega/push') },
    { hotkey: 'S', label: 'Status of all', onPress: () => onRunCommand('mega/status') },
  ];

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
        title={`Remotes (${remotes.length + vendored.length})`}
        items={items}
        emptyText="No remotes — add one with git remote add."
        detailTitle={current?.name ?? currentVendored?.dir ?? 'Remote'}
        reservedChrome={['viewHeader', ...reservedChrome]}
        activateLabel="open in browser"
        activateOnClick={false}
        isInputActive={!prompt.isOpen}
        hints={[
          { key: 'f', label: 'fetch', onPress: fetch },
          { key: 'p', label: 'pull', onPress: pull },
          currentVendored
            ? { key: 'P', label: 'push all', onPress: () => onRunCommand('mega/push') }
            : { key: 'P', label: 'push', onPress: () => push() },
          ...(vendored.length
            ? [{ key: 'S', label: 'status of all', onPress: () => onRunCommand('mega/status') }]
            : []),
          ...(current ? [{ key: 'x', label: `remove ${current.name}`, onPress: () => remove() }] : []),
        ]}
        onActivate={(item) => {
          const url = item.value?.kind === 'remote' && remoteWebUrl(item.value.remote.fetchUrl);
          if (url) openUrl(url);
        }}
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return <Toolbar actions={actions} maxRows={toolbarRows + 3} />;
          if (row.kind === 'vendored') {
            return (
              <Box flexDirection="column">
                {/* The detail below takes eleven lines; what is left can hold the stack */}
                <Toolbar actions={vendoredActions} maxRows={toolbarRows - 8} />
                <VendoredDetail entry={row.entry} />
              </Box>
            );
          }
          const { remote } = row;
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

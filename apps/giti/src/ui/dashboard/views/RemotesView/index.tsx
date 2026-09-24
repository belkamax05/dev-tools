import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import LinkRow from '@/dev-tools/ui/components/LinkRow';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import openUrl, { remoteWebUrl } from '@/dev-tools/utils/system/openUrl';

import { getBranches } from '../../../../core/branches';
import {
  fetchAll,
  getRemotes,
  pullCurrent,
  pushCurrent,
  type Remote,
} from '../../../../core/remotes';
import type { OperationResult } from '../../../../core/status';
import type { GitViewProps } from '../../types';

/**
 * Remotes, and the three things done with them — fetch, pull, push — with
 * git's own progress shown live while they run. The button the branch most
 * likely needs is the highlighted one: push when ahead, pull when behind.
 * Force-pushing exists only as `--force-with-lease`, and asks first.
 */
export const RemotesView = ({
  root,
  refreshKey,
  reload,
  notify,
  onCaptureInput,
  reservedChrome,
}: GitViewProps) => {
  const colors = useColors();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<string | undefined>(undefined);

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

  const fetch = () => void run('Fetching', (onProgress) => fetchAll(root, onProgress));
  const pull = () => void run('Pulling', (onProgress) => pullCurrent(root, onProgress));
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

  useInput(
    (input) => {
      if (input === 'f') fetch();
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
  const actions: ToolbarAction[] = [
    {
      hotkey: 'f',
      label: 'Fetch',
      onPress: fetch,
      tone: !ahead && !behind ? 'primary' : 'normal',
      disabled: Boolean(progress),
    },
    {
      hotkey: 'l',
      label: behind ? `Pull ↓${behind}` : 'Pull',
      onPress: pull,
      tone: behind ? 'primary' : 'normal',
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

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text wrap="truncate" color={progress ? colors.accent : colors.muted}>
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
        ]}
        onActivate={(item) => {
          const url = item.value && remoteWebUrl(item.value.fetchUrl);
          if (url) openUrl(url);
        }}
        onSelectionChange={(item) => setCurrentId(item?.id)}
        renderDetail={(item) => {
          const remote = item?.value;
          if (!remote) return <Toolbar actions={actions} />;
          const url = remoteWebUrl(remote.fetchUrl);
          return (
            <Box flexDirection="column">
              <Toolbar actions={actions} />
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

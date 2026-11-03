import { render, Text, useApp, useInput } from 'ink';
import { useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import {
  getRemoteStashDiff,
  getRemoteStashes,
  getRemoteStashFiles,
  type RemoteStash,
} from '../../core/remoteStash';
import PatchLines, { PATCH_SCROLL_HINT } from '../dashboard/PatchLines';
import SpinnerGlyph from '../dashboard/SpinnerGlyph';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';

export type RemoteStashMode = 'apply' | 'remove';

//? Past this the file list would push the diff off a regular terminal; the diff names them all
const MAX_FILES = 10;

export interface RenderInkRemoteStashesOptions {
  cwd: string;
  remote: string;
  mode: RemoteStashMode;
  /** The row to open on — a name given on the command line. */
  initialName?: string;
  /** Apply only: restore what was staged as staged. */
  initialIndex?: boolean;
}

export interface RemoteStashChoice {
  stash: RemoteStash;
  /** Apply only. */
  index: boolean;
}

/**
 * The remote's stashes, each with the files it carries and its diff — what `apply` would bring in
 * or `remove` would throw away, seen before it happens. Picking one closes the screen; the command
 * does the rest.
 */
export const RemoteStashPicker = ({
  cwd,
  remote,
  mode,
  initialName,
  initialIndex = true,
  onPick,
}: RenderInkRemoteStashesOptions & { onPick: (choice: RemoteStashChoice) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const height = Math.max(1, viewport.rows - useTuiTheme().sizes.app.heldBackRows);
  const [captured, setCaptured] = useState(false);
  const prompt = usePrompt(setCaptured);
  const [index, setIndex] = useState(initialIndex);
  const [currentName, setCurrentName] = useState(initialName);

  const {
    data: stashes = [],
    isLoading,
    error,
  } = useLoader(() => getRemoteStashes(cwd, remote), [cwd, remote]);
  const current = stashes.find((stash) => stash.name === currentName);
  const { data: preview } = useLoader(
    async () =>
      current
        ? {
            files: await getRemoteStashFiles(cwd, current.hash),
            diff: await getRemoteStashDiff(cwd, current.hash),
          }
        : undefined,
    [current?.hash],
  );

  const pick = (stash: RemoteStash) => {
    const done = () => {
      onPick({ stash, index });
      exit();
    };
    if (mode === 'remove')
      prompt.confirm(`Remove ${stash.name} from ${remote} for everyone?`, done);
    else done();
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return exit();
      if (key.escape || input === 'q') return exit();
      if (mode === 'apply' && input === 'i') setIndex((on) => !on);
    },
    { isActive: !captured },
  );

  const items: PickItem<RemoteStash>[] = stashes.map((stash) => ({
    id: stash.name,
    label: stash.name,
    hint: `${stash.author} · ${stash.when}`,
    value: stash,
  }));
  const verb = mode === 'apply' ? 'Apply' : 'Remove';

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Box flexShrink={0}>
        {prompt.line ?? (
          <Text wrap="truncate" color={error ? colors.error : colors.muted}>
            {isLoading && <SpinnerGlyph />}
            {isLoading
              ? `Reading stashes from ${remote}…`
              : error
                ? String(error)
                : `${stashes.length} stash(es) on ${remote}${mode === 'apply' ? ` · staged changes ${index ? 'restored as staged' : 'applied unstaged'} [i]` : ''}`}
          </Text>
        )}
      </Box>
      <ListDetail
        detailScroll={false}
        title={`Stashes on ${remote} (${stashes.length})`}
        items={items}
        initialSelectedId={initialName}
        emptyText={isLoading ? '' : `No stashes on ${remote} — giti stash save shares one.`}
        detailTitle={current ? `${current.name} · ${current.branch || 'no branch'}` : 'Stash'}
        reservedChrome={['viewHeader']}
        activateLabel={mode}
        activateOnClick={false}
        isInputActive={!captured}
        fitToHost
        hints={[
          PATCH_SCROLL_HINT,
          ...(mode === 'apply'
            ? [{ key: 'i', label: 'keep staged', onPress: () => setIndex((on) => !on) }]
            : []),
          { key: 'Esc/q', label: 'cancel', onPress: exit },
        ]}
        onActivate={(item) => item.value && pick(item.value)}
        onSelectionChange={(item) => setCurrentName(item?.id)}
        renderDetail={(item) => {
          const stash = item?.value;
          if (!stash) return null;
          return (
            <Box flexDirection="column" flexGrow={1} minHeight={0}>
              <Toolbar
                actions={[
                  {
                    hotkey: 'Enter',
                    label: verb,
                    onPress: () => pick(stash),
                    tone: mode === 'apply' ? 'primary' : 'danger',
                  },
                ]}
              />
              <Text color={colors.muted} wrap="truncate">
                {stash.author} · {stash.when} · taken on {stash.branch || 'no branch'} ·{' '}
                {preview?.files.length ?? '…'} file(s)
              </Text>
              {preview?.files.slice(0, MAX_FILES).map((file) => (
                <Text key={file.path} wrap="truncate">
                  <Text color={file.status === 'D' ? colors.error : colors.accent}>
                    {file.status.padEnd(2)}
                  </Text>
                  {file.path}
                </Text>
              ))}
              {(preview?.files.length ?? 0) > MAX_FILES && (
                <Text color={colors.muted}>
                  …and {(preview?.files.length ?? 0) - MAX_FILES} more in the diff below
                </Text>
              )}
              <PatchLines text={preview?.diff ?? ''} isActive={!captured} />
            </Box>
          );
        }}
      />
    </Box>
  );
};

/** Open the picker; resolves with the stash picked, or nothing when cancelled. */
const renderInkRemoteStashes = async (options: RenderInkRemoteStashesOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  let choice: RemoteStashChoice | undefined;
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <RemoteStashPicker
        {...options}
        onPick={(picked) => {
          choice = picked;
        }}
      />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
  return choice;
};

export default renderInkRemoteStashes;

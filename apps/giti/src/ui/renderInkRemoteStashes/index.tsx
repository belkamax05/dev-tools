import { render, Text, useApp, useInput } from 'ink';
import { type ReactNode, useEffect, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';
import hotkeys from '@/dev-tools/config/hotkeys';

import {
  getRemoteStashDiff,
  getRemoteStashes,
  getRemoteStashFileDiff,
  getRemoteStashFiles,
  type RemoteStash,
  type StashFile,
} from '../../core/remoteStash';
import FileChecklist from '../dashboard/FileChecklist';
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
  /** Apply only: the files to start ticked (`-- <paths>`); all of them when left out. */
  initialPaths?: string[];
}

export interface RemoteStashChoice {
  stash: RemoteStash;
  /** Apply only. */
  index: boolean;
  /** Apply only: the files ticked, or nothing when every file is — the whole stash. */
  paths?: string[];
}

/** How a file arrives when the stash is applied. */
export const describeStashFile = (file: StashFile) =>
  file.untracked
    ? 'new, untracked'
    : file.status === 'D'
      ? 'deleted'
      : file.staged && file.unstaged
        ? 'staged + unstaged'
        : file.staged
          ? 'staged'
          : 'unstaged';

/**
 * Apply's second step: one stash's files as a checklist, each beside its diff, every file ticked
 * to start with (or the ones named on the command line). Enter applies the ticked ones, Esc goes
 * back to the stashes.
 */
export const StashFilesStep = ({
  cwd,
  stash,
  index,
  initialPaths,
  onToggleIndex,
  onBack,
  onApply,
}: {
  cwd: string;
  stash: RemoteStash;
  index: boolean;
  initialPaths?: string[];
  onToggleIndex: () => void;
  onBack: () => void;
  onApply: (paths: string[] | undefined) => void;
}) => {
  const colors = useColors();
  const compact = useViewport().byRows({ short: true, regular: false });
  const { data: files } = useLoader(() => getRemoteStashFiles(cwd, stash.hash), [stash.hash]);
  const [chosen, setChosen] = useState<Set<string>>();
  const [notice, setNotice] = useState('');
  //? Ticked once the files are known — all of them, or the command line's
  useEffect(() => {
    if (files && !chosen)
      setChosen(new Set(initialPaths ?? files.map((file) => file.path)));
  }, [files, chosen, initialPaths]);
  const ticked = (files ?? []).filter((file) => chosen?.has(file.path));

  const apply = () => {
    if (!files) return;
    if (!ticked.length) return setNotice('Tick at least one file to apply.');
    onApply(ticked.length === files.length ? undefined : ticked.map((file) => file.path));
  };

  useInput((input, key) => {
    if (key.escape || input === hotkeys.quit) return onBack();
    if (key.return) return apply();
    if (input === 'i') onToggleIndex();
  });

  return (
    <>
      <Box flexDirection="column" flexShrink={0}>
        <Toolbar
          actions={[
            { hotkey: 'Esc/q', label: 'Back to stashes', onPress: onBack },
            { hotkey: 'Enter', label: 'Apply ticked', onPress: apply, tone: 'primary' },
            {
              hotkey: 'i',
              label: index ? 'Staged stay staged' : 'All unstaged',
              onPress: onToggleIndex,
            },
          ]}
        />
        <Text color={colors.muted} wrap="truncate">
          {stash.name} · {stash.author} · {stash.when} · taken on {stash.branch || 'no branch'}
        </Text>
      </Box>
      {files && chosen ? (
        <FileChecklist
          files={files.map((file) => ({ path: file.path, hint: describeStashFile(file) }))}
          chosen={chosen}
          onChange={(next) => {
            setChosen(next);
            setNotice('');
          }}
          loadDiff={(file) => {
            const stashFile = files.find((f) => f.path === file.path);
            return stashFile
              ? getRemoteStashFileDiff(cwd, stash.hash, stashFile)
              : Promise.resolve('');
          }}
          verb="apply"
          isInputActive
          showHints={!compact}
        />
      ) : (
        <Text color={colors.muted}>
          <SpinnerGlyph /> Reading the stash…
        </Text>
      )}
      <Text color={notice ? colors.warn : colors.muted} wrap="truncate">
        {notice ||
          `${ticked.length} of ${files?.length ?? '…'} file(s) to apply · Space in/out · a all/none · Enter apply · Esc back`}
      </Text>
    </>
  );
};

export interface RemoteStashListProps {
  cwd: string;
  remote: string;
  stashes: RemoteStash[];
  isLoading: boolean;
  initialName?: string;
  isInputActive: boolean;
  /** `usePrompt`'s inline yes/no, drawn under the selected stash. */
  question?: ReactNode;
  /** What Enter does, in the hints. */
  activateLabel: string;
  onActivate: (stash: RemoteStash) => void;
  /** The buttons over the selected stash's files and diff. */
  actionsFor: (stash: RemoteStash) => ToolbarAction[];
  hints: Hint[];
  /** Told which stash the cursor is on, for keys the caller binds itself. */
  onCurrentChange?: (stash: RemoteStash | undefined) => void;
}

/**
 * The remote's stashes on the left; on the right the selected one's buttons, who took it and
 * where, the files it carries and its whole diff. The pane both the apply/remove picker and the
 * `giti stash` dashboard are built around — they differ only in what the buttons do.
 */
export const RemoteStashList = ({
  cwd,
  remote,
  stashes,
  isLoading,
  initialName,
  isInputActive,
  question,
  activateLabel,
  onActivate,
  actionsFor,
  hints,
  onCurrentChange,
}: RemoteStashListProps) => {
  const colors = useColors();
  const [currentName, setCurrentName] = useState(initialName);
  const current = stashes.find((stash) => stash.name === currentName);
  //? On `current` alone: a caller's inline callback is new every render and would re-fire this
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => onCurrentChange?.(current), [current]);
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

  const items: PickItem<RemoteStash>[] = stashes.map((stash) => ({
    id: stash.name,
    label: stash.name,
    hint: `${stash.author} · ${stash.when}`,
    value: stash,
  }));

  return (
    <ListDetail
      question={question}
      detailScroll={false}
      title={`Stashes on ${remote} (${stashes.length})`}
      items={items}
      initialSelectedId={initialName}
      emptyText={isLoading ? '' : `No stashes on ${remote} yet.`}
      detailTitle={current ? `${current.name} · ${current.branch || 'no branch'}` : 'Stash'}
      reservedChrome={['viewHeader']}
      activateLabel={activateLabel}
      activateOnClick={false}
      isInputActive={isInputActive}
      fitToHost
      hints={[PATCH_SCROLL_HINT, ...hints]}
      onActivate={(item) => item.value && onActivate(item.value)}
      onSelectionChange={(item) => setCurrentName(item?.id)}
      renderDetail={(item) => {
        const stash = item?.value;
        if (!stash) return null;
        return (
          <Box flexDirection="column" flexGrow={1} minHeight={0}>
            <Toolbar actions={actionsFor(stash)} />
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
            <PatchLines text={preview?.diff ?? ''} isActive={isInputActive} />
          </Box>
        );
      }}
    />
  );
};

/**
 * The remote's stashes, each with the files it carries and its diff — what `apply` would bring in
 * or `remove` would throw away, seen before it happens. For `apply`, Enter opens the stash's files
 * as a checklist (`StashFilesStep`) to take only some of them; a name given on the command line
 * opens there directly. The screen closes on the choice; the command does the rest.
 */
export const RemoteStashPicker = ({
  cwd,
  remote,
  mode,
  initialName,
  initialIndex = true,
  initialPaths,
  onPick,
}: RenderInkRemoteStashesOptions & { onPick: (choice: RemoteStashChoice) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const height = Math.max(1, viewport.rows - useTuiTheme().sizes.app.heldBackRows);
  const [captured, setCaptured] = useState(false);
  const prompt = usePrompt(setCaptured, { inlineConfirm: true });
  const [index, setIndex] = useState(initialIndex);

  const {
    data: stashes = [],
    isLoading,
    error,
  } = useLoader(() => getRemoteStashes(cwd, remote), [cwd, remote]);

  //? The stash whose files are open (apply's second step); a typed name skips straight to it
  const [opened, setOpened] = useState<RemoteStash>();
  const [openedTyped, setOpenedTyped] = useState(false);
  useEffect(() => {
    if (mode !== 'apply' || openedTyped || !initialName) return;
    const typed = stashes.find((stash) => stash.name === initialName);
    if (typed) {
      setOpened(typed);
      setOpenedTyped(true);
    }
  }, [mode, initialName, openedTyped, stashes]);

  const pick = (stash: RemoteStash) => {
    if (mode === 'apply') return setOpened(stash);
    prompt.confirm(`Remove ${stash.name} from ${remote} for everyone?`, () => {
      onPick({ stash, index });
      exit();
    });
  };

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') return exit();
      if (opened) return;
      if (key.escape || input === hotkeys.quit) return exit();
      if (mode === 'apply' && input === 'i') setIndex((on) => !on);
    },
    { isActive: !captured },
  );

  if (opened) {
    return (
      <Box flexDirection="column" height={height} paddingX={1}>
        <StashFilesStep
          cwd={cwd}
          stash={opened}
          index={index}
          //? Only the stash named with them: another one picked afterwards starts all ticked
          initialPaths={opened.name === initialName ? initialPaths : undefined}
          onToggleIndex={() => setIndex((on) => !on)}
          onBack={() => setOpened(undefined)}
          onApply={(paths) => {
            onPick({ stash: opened, index, paths });
            exit();
          }}
        />
      </Box>
    );
  }

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
      <RemoteStashList
        cwd={cwd}
        remote={remote}
        stashes={stashes}
        isLoading={isLoading}
        initialName={initialName}
        isInputActive={!captured}
        question={prompt.question}
        activateLabel={mode === 'apply' ? 'choose files' : 'remove'}
        onActivate={pick}
        actionsFor={(stash) => [
          {
            hotkey: 'Enter',
            label: mode === 'apply' ? 'Choose files…' : 'Remove',
            onPress: () => pick(stash),
            tone: mode === 'apply' ? 'primary' : 'danger',
          },
        ]}
        hints={[
          ...(mode === 'apply'
            ? [{ key: 'i', label: 'keep staged', onPress: () => setIndex((on) => !on) }]
            : []),
          { key: 'Esc/q', label: 'cancel', onPress: exit },
        ]}
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

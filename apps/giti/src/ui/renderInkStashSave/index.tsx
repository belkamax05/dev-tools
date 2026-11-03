import { TextInput } from '@inkjs/ui';
import { render, Text, useApp, useInput } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import TerminalTooSmall from '@/dev-tools/ui/components/TerminalTooSmall';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { checkStashName } from '../../core/remoteStash';
import { getDiff } from '../../core/hunks';
import { type FileChange, getChanges } from '../../core/status';
import FlagsPanel, { type FlagOption } from '../dashboard/FlagsPanel';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import useRepoWatch from '../dashboard/useRepoWatch';
import FileChecklist from '../dashboard/FileChecklist';

/** How a file will travel: what applying the stash will make of it on the other side. */
const describeChange = (change: FileChange) =>
  change.conflicted
    ? 'conflict'
    : change.untracked
      ? 'new, untracked'
      : change.staged && change.unstaged
        ? 'staged + unstaged'
        : change.staged
          ? 'staged'
          : 'unstaged';

/**
 * What a file would bring into the stash: its staged diff and its unstaged one, each under a line
 * saying which — that split is what arrives on the other side — or the whole of a new file.
 */
const changeDiff = async (root: string, change: FileChange) => {
  if (change.untracked) return getDiff(root, change.path, 'untracked');
  const [staged, unstaged] = await Promise.all([
    change.staged ? getDiff(root, change.path, 'staged') : '',
    change.unstaged ? getDiff(root, change.path, 'unstaged') : '',
  ]);
  return [staged && `### staged — arrives staged\n${staged}`, unstaged && `### unstaged\n${unstaged}`]
    .filter(Boolean)
    .join('\n');
};

const FLAGS: readonly FlagOption[] = [
  {
    flag: '--force',
    label: 'Replace',
    about: 'Overwrite a stash of the same name on the remote — the old one is gone for everyone.',
  },
];

type Section = 'files' | 'name' | 'flags';

export interface RenderInkStashSaveOptions {
  cwd: string;
  remote: string;
  initialName?: string;
  initialForce?: boolean;
  /** Paths to start ticked (`giti stash save <name> -- <paths>`); every change when left out. */
  initialPaths?: string[];
}

export interface StashSaveChoice {
  name: string;
  force: boolean;
  /** Repository-relative paths that go into the stash. */
  paths: string[];
}

/**
 * `giti stash save`'s screen: the changed files as a checklist of what goes into the stash, each
 * with its diff, a name, and the flags — laid out as `giti save` lays out its own.
 *
 * Ticking is not staging: nothing here writes to the work tree or the index. A ticked file is
 * stashed whole, its staged part arriving staged on the other side. Enter with a name closes the
 * screen; the command pushes after it.
 */
export const StashSaveForm = ({
  cwd,
  remote,
  initialName,
  initialForce = false,
  initialPaths,
  onSave,
}: RenderInkStashSaveOptions & { onSave: (choice: StashSaveChoice) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const { app } = useTuiTheme().sizes;
  const height = Math.max(1, viewport.rows - app.heldBackRows);
  const compact = viewport.byRows({ short: true, regular: false });
  const [section, setSection] = useState<Section>('files');
  const [name, setName] = useState(initialName ?? '');
  const [flags, setFlags] = useState(new Set(initialForce ? ['--force'] : []));
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState('');
  const lastName = useRef(name);
  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);
  useRepoWatch(cwd, reload);

  const { data: changes = [] } = useLoader(() => getChanges(cwd), [cwd, refreshKey]);
  const [chosen, setChosen] = useState<Set<string>>(new Set(initialPaths));
  //? A file that turns up while the screen is open is ticked like the rest — unless the command
  //? line named the files, which is a choice already made
  const known = useRef(new Set<string>());
  useEffect(() => {
    const fresh = changes.filter((change) => !known.current.has(change.path));
    if (!fresh.length) return;
    for (const change of fresh) known.current.add(change.path);
    if (!initialPaths)
      setChosen((previous) => new Set([...previous, ...fresh.map((change) => change.path)]));
  }, [changes, initialPaths]);
  //? Only files still changed count: one reverted elsewhere drops out of the stash on its own
  const picked = changes.filter((change) => chosen.has(change.path));

  const submit = async () => {
    const trimmed = name.trim();
    if (!picked.length) {
      setSection('files');
      return setNotice('Tick at least one file to stash.');
    }
    const conflicted = picked.find((change) => change.conflicted);
    if (conflicted) return setNotice(`Resolve ${conflicted.path} first, or leave it out.`);
    const invalid = await checkStashName(cwd, trimmed);
    if (invalid) {
      setSection('name');
      return setNotice(invalid);
    }
    onSave({ name: trimmed, force: flags.has('--force'), paths: picked.map((c) => c.path) });
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (key.escape) return exit();
    if (input === 'q' && !key.ctrl && !key.meta && section !== 'name') return exit();
    if (key.tab) {
      const sections: Section[] = ['files', 'name', 'flags'];
      setSection(sections[(sections.indexOf(section) + (key.shift ? 2 : 1)) % 3] ?? 'files');
    } else if (key.return) {
      if (!name.trim() && section !== 'name') setSection('name');
      else void submit();
    }
  });

  if (viewport.rows < app.minHeight)
    return <TerminalTooSmall columns={viewport.columns} rows={viewport.rows} />;

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <Box flexDirection="column" flexShrink={0}>
        <Toolbar
          actions={[
            {
              hotkey: 'Tab',
              label: `Focus: ${section}`,
              onPress: () =>
                setSection(section === 'files' ? 'name' : section === 'name' ? 'flags' : 'files'),
            },
            { hotkey: section === 'name' ? 'Esc' : 'Esc/q', label: 'Cancel', onPress: exit },
            { hotkey: 'Enter', label: `Save to ${remote}`, onPress: () => void submit() },
          ]}
        />
        {!compact && (
          <Text color={colors.accent} wrap="truncate">
            Ticked files go into the stash · your work tree and index are not touched
          </Text>
        )}
      </Box>
      <FileChecklist
        files={changes.map((change) => ({
          path: change.path,
          label: change.origPath ? `${change.origPath} → ${change.path}` : undefined,
          hint: describeChange(change),
          hintColor: change.conflicted ? colors.error : undefined,
          version: `${change.index}${change.work}${refreshKey}`,
        }))}
        chosen={chosen}
        onChange={(next) => {
          setChosen(next);
          setNotice('');
        }}
        loadDiff={(file) => {
          const change = changes.find((c) => c.path === file.path);
          return change ? changeDiff(cwd, change) : Promise.resolve('');
        }}
        verb="stash"
        emptyText="Nothing to stash — the working tree is clean."
        isInputActive={section === 'files'}
        showHints={!compact}
      />
      <Box flexDirection="column" flexShrink={0}>
        <Panel title={compact ? undefined : 'Stash name'} isFocused={section === 'name'}>
          <Box>
            {compact && (
              <Text bold color={section === 'name' ? colors.accent : colors.muted}>
                {'Name › '}
              </Text>
            )}
            <TextInput
              defaultValue={name}
              placeholder="me/feature-wip…"
              onChange={(value) => {
                if (value === lastName.current) return;
                lastName.current = value;
                setName(value);
                setNotice('');
              }}
              isDisabled={section !== 'name'}
            />
          </Box>
        </Panel>
        <FlagsPanel
          options={FLAGS}
          on={flags}
          onToggle={(flag) =>
            setFlags((previous) => {
              const next = new Set(previous);
              if (next.has(flag)) next.delete(flag);
              else next.add(flag);
              return next;
            })
          }
          focused={section === 'flags'}
          onFocus={() => setSection('flags')}
          enterLabel="save"
          compact={compact}
        />
        <Text color={notice ? colors.warn : colors.muted} wrap="truncate">
          {notice ||
            (section === 'files'
              ? `${picked.length} of ${changes.length} file(s) in the stash · Space in/out · a all/none · Tab change focus · Enter save`
              : 'Tab change focus · Enter save · Esc cancel')}
        </Text>
      </Box>
    </Box>
  );
};

/** Open the screen; resolves with the name, flags and files chosen, or nothing when cancelled. */
const renderInkStashSave = async (options: RenderInkStashSaveOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  let choice: StashSaveChoice | undefined;
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <StashSaveForm
        {...options}
        onSave={(picked) => {
          choice = picked;
        }}
      />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
  return choice;
};

export default renderInkStashSave;

import { TextInput } from '@inkjs/ui';
import { render, Text, useApp, useInput } from 'ink';
import { useCallback, useRef, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import TerminalTooSmall from '@/dev-tools/ui/components/TerminalTooSmall';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { checkStashName } from '../../core/remoteStash';
import { getChanges } from '../../core/status';
import FlagsPanel, { type FlagOption } from '../dashboard/FlagsPanel';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import useRepoWatch from '../dashboard/useRepoWatch';
import { DEFAULT_REFRESH_SECONDS } from '../dashboard/views/SettingsView';
import StatusView from '../dashboard/views/StatusView';

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
}

export interface StashSaveChoice {
  name: string;
  force: boolean;
}

/**
 * `giti stash save`'s screen: `giti save`'s staging area as the preview of what will be shared,
 * with a stash name where the commit message goes.
 *
 * Everything listed is stashed, staged or not — staging here only decides what arrives staged on
 * the other side. Enter on a name closes the screen; the command pushes after it.
 */
export const StashSaveForm = ({
  cwd,
  remote,
  initialName,
  initialForce = false,
  onSave,
}: RenderInkStashSaveOptions & { onSave: (choice: StashSaveChoice) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const { app } = useTuiTheme().sizes;
  const height = Math.max(1, viewport.rows - app.heldBackRows);
  const compact = viewport.byRows({ short: true, regular: false });
  const [section, setSection] = useState<Section>(initialName ? 'flags' : 'name');
  const [name, setName] = useState(initialName ?? '');
  const [flags, setFlags] = useState(new Set(initialForce ? ['--force'] : []));
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [captured, setCaptured] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [staging, setStaging] = useState(false);
  const lastName = useRef(name);
  const reload = useCallback(() => setRefreshKey((key) => key + 1), []);
  useRepoWatch(cwd, reload);

  const submit = async () => {
    if (captured || staging) return;
    const trimmed = name.trim();
    const invalid = await checkStashName(cwd, trimmed);
    if (invalid) {
      setNotice(invalid);
      setSection('name');
      return;
    }
    const changes = await getChanges(cwd);
    if (!changes.length) return setNotice('Nothing to stash — the working tree is clean.');
    if (changes.some((change) => change.conflicted))
      return setNotice('Resolve conflicts before stashing.');
    onSave({ name: trimmed, force: flags.has('--force') });
    exit();
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (previewOpen) return;
    if (key.escape) return exit();
    if (captured || staging) return;
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
      {!previewOpen && (
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
              Every file below is stashed — staged ones arrive staged. Your work tree is left as it
              is.
            </Text>
          )}
        </Box>
      )}
      <StatusView
        root={cwd}
        refreshKey={refreshKey}
        reload={reload}
        notify={setNotice}
        onCaptureInput={setCaptured}
        handoff={() => {}}
        offerUndo={() => {}}
        reservedChrome={[]}
        stagingOnly
        onPreviewModeChange={setPreviewOpen}
        onBusyChange={setStaging}
        isInputActive={section === 'files'}
        showHints={!compact}
        fitToHost
      />
      {!previewOpen && (
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
                isDisabled={section !== 'name' || captured}
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
            focused={section === 'flags' && !captured && !staging}
            onFocus={() => setSection('flags')}
            enterLabel="save"
            compact={compact}
          />
          <Text color={notice ? colors.warn : colors.muted} wrap="truncate">
            {notice ||
              (section === 'files'
                ? 'Space stage/unstage · Tab change focus · Enter save'
                : 'Tab change focus · Enter save · Esc cancel')}
          </Text>
        </Box>
      )}
    </Box>
  );
};

/** Open the screen; resolves with the name and flags chosen, or nothing when cancelled. */
const renderInkStashSave = async (options: RenderInkStashSaveOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE, refreshSeconds: DEFAULT_REFRESH_SECONDS },
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

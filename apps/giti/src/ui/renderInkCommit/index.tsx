import { TextInput } from '@inkjs/ui';
import { render, Text, useApp, useInput } from 'ink';
import { useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import { TuiThemeProvider, useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { getChanges } from '../../core/status';
import saveCommit from '../../utils/saveCommit';
import gitiTheme from '../dashboard/theme';
import StatusView from '../dashboard/views/StatusView';

const FLAGS = [
  ['--no-verify', 'Skip hooks'],
  ['--amend', 'Amend'],
  ['--allow-empty', 'Allow empty'],
  ['--signoff', 'Sign off'],
  ['--push', 'Push after commit'],
] as const;

type Section = 'files' | 'message' | 'flags';

export interface RenderInkCommitOptions {
  initialMessage?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
}

export const CommitForm = ({
  cwd,
  initialMessage,
  initialFlags,
  passthroughFlags,
  onCommit,
}: RenderInkCommitOptions & { onCommit: (args: string[], push: boolean) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  const [section, setSection] = useState<Section>('files');
  const [message, setMessage] = useState(initialMessage ?? '');
  const [flags, setFlags] = useState(new Set(initialFlags));
  const [refreshKey, setRefreshKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [captured, setCaptured] = useState(false);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [staging, setStaging] = useState(false);
  const [quickMessage, setQuickMessage] = useState(false);
  const toggle = (flag: string) =>
    setFlags((previous) => {
      const next = new Set(previous);
      if (next.has(flag)) next.delete(flag);
      else next.add(flag);
      return next;
    });

  const submit = async () => {
    if (submitting || staging || captured) return;
    if (!message.trim() && !flags.has('--amend')) {
      setNotice('Enter a commit message.');
      setSection('message');
      return;
    }
    setSubmitting(true);
    setQuickMessage(false);
    try {
      const changes = await getChanges(cwd);
      if (changes.some((change) => change.conflicted)) {
        setNotice('Resolve conflicts before committing.');
        setSection('files');
        return;
      }
      if (
        !flags.has('--allow-empty') &&
        !flags.has('--amend') &&
        !changes.some((change) => change.staged)
      ) {
        setNotice('Select changes to stage before committing.');
        setSection('files');
        return;
      }
      const args = [
        'commit',
        ...[...flags].filter((flag) => flag !== '--push'),
        ...passthroughFlags,
      ];
      if (message.trim()) args.push('-m', message.trim());
      else if (flags.has('--amend')) args.push('--no-edit');
      onCommit(args, flags.has('--push'));
      exit();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const needsMessage = !message.trim() && !flags.has('--amend');
  const quickCommit = () => {
    if (captured || submitting || staging) return;
    if (needsMessage) {
      setNotice('');
      setQuickMessage(true);
    } else void submit();
  };
  const nextStep = needsMessage
    ? 'Enter commit message'
    : section === 'flags'
      ? 'Save'
      : 'Review flags';
  const advance = () => {
    if (captured || submitting || staging) return;
    if (needsMessage) {
      setNotice('Enter a commit message.');
      setSection('message');
    } else if (section === 'flags') {
      void submit();
    } else {
      setNotice('Review flags, then press Enter to save.');
      setSection('flags');
    }
  };

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return exit();
    if (quickMessage) {
      if (key.escape) setQuickMessage(false);
      else if (key.return) {
        if (needsMessage) setNotice('Enter a commit message.');
        else void submit();
      }
      return;
    }
    if (filePreviewOpen) return;
    if (key.escape) return exit();
    if (captured || submitting || staging) return;
    if (key.return && key.shift) return quickCommit();
    if (key.tab) {
      const sections: Section[] = ['files', 'message', 'flags'];
      setSection(sections[(sections.indexOf(section) + (key.shift ? 2 : 1)) % 3] ?? 'files');
    } else if (key.return) advance();
    else if (section === 'flags') {
      const flag = FLAGS[Number(input) - 1]?.[0];
      if (flag) toggle(flag);
    }
  });

  const messageInput = (
    <TextInput
      defaultValue={message}
      placeholder="Commit message…"
      onChange={(value) => {
        setMessage(value);
        setNotice('');
      }}
      isDisabled={(!quickMessage && section !== 'message') || captured || submitting}
    />
  );

  if (quickMessage) {
    return (
      <Box flexGrow={1} justifyContent="center" alignItems="center" paddingX={1}>
        <Box width={72} maxWidth="100%" flexDirection="column">
          <Panel title="Commit message" isFocused>
            {messageInput}
            {notice && <Text color={colors.warn}>{notice}</Text>}
            <Toolbar
              actions={[
                { hotkey: 'Enter', label: 'Commit', onPress: quickCommit },
                { hotkey: 'Esc', label: 'Cancel', onPress: () => setQuickMessage(false) },
              ]}
            />
          </Panel>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {!filePreviewOpen && (
        <>
          <Toolbar
            actions={[
              {
                hotkey: 'Tab',
                label: `Focus: ${section}`,
                onPress: () =>
                  setSection(
                    section === 'files' ? 'message' : section === 'message' ? 'flags' : 'files',
                  ),
              },
              { hotkey: 'Esc', label: 'Cancel', onPress: exit },
              { hotkey: 'Shift+Enter', label: 'Commit now', onPress: quickCommit },
            ]}
          />
          <Text color={colors.accent}>Enter → {nextStep}</Text>
        </>
      )}
      <StatusView
        root={cwd}
        refreshKey={refreshKey}
        reload={() => setRefreshKey((key) => key + 1)}
        notify={setNotice}
        onCaptureInput={setCaptured}
        handoff={() => {}}
        offerUndo={() => {}}
        reservedChrome={[]}
        stagingOnly
        onPreviewModeChange={setFilePreviewOpen}
        onBusyChange={setStaging}
        isInputActive={section === 'files' && !submitting}
      />
      {!filePreviewOpen && (
        <>
          <Panel title="Commit message" isFocused={section === 'message'}>
            <ActionButton hotkey="Tab" label="Edit message" onPress={() => setSection('message')} />
            {messageInput}
          </Panel>
          <Panel title="Flags · 1–5 toggle · Enter to save" isFocused={section === 'flags'}>
            <Box flexDirection="row" flexWrap="wrap">
              {FLAGS.map(([flag, label], index) => (
                <ActionButton
                  key={flag}
                  hotkey={String(index + 1)}
                  label={label}
                  isOn={flags.has(flag)}
                  onPress={() => {
                    setSection('flags');
                    toggle(flag);
                  }}
                />
              ))}
            </Box>
          </Panel>
          <Text color={colors.muted} wrap="truncate">
            {notice || `Space stage/unstage · Tab change focus · Enter → ${nextStep}`}
          </Text>
        </>
      )}
    </Box>
  );
};

const renderInkCommit = async (options: RenderInkCommitOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: 'classic' },
  }).load();
  let selection: { args: string[]; push: boolean } | undefined;
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <CommitForm
        {...options}
        onCommit={(args, push) => {
          selection = { args, push };
        }}
      />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
  if (!selection) return;
  const result = await saveCommit(options.cwd, selection.args, selection.push, { stream: true });
  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode ?? 1;
    return;
  }
};

export default renderInkCommit;

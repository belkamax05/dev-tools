import { TextInput } from '@inkjs/ui';
import { type DOMElement, render, Text, useApp, useInput } from 'ink';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useTerminalSize from '@/dev-tools/ui/hooks/useTerminalSize';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import { getChanges } from '../../core/status';
import saveCommit from '../../utils/saveCommit';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import FlagsPanel, { type FlagOption } from '../dashboard/FlagsPanel';
import SyncBar from '../dashboard/SyncBar';
import useRemoteSync from '../dashboard/useRemoteSync';
import useRepoSnapshot from '../dashboard/useRepoSnapshot';
import useRepoWatch from '../dashboard/useRepoWatch';
import { DEFAULT_REFRESH_SECONDS } from '../dashboard/views/SettingsView';
import StatusView from '../dashboard/views/StatusView';

/**
 * The message line, clickable: a click puts the cursor in it, as Tab reaching it does. It is the
 * field itself that answers the pointer — a separate "edit" button beside it named Tab, which
 * only steps from panel to panel.
 */
const MessageField = ({ onFocus, children }: { onFocus: () => void; children: ReactNode }) => {
  const ref = useRef<DOMElement>(null);
  useClickable(ref, { onClick: onFocus, pointer: 'text' });
  return <Box ref={ref}>{children}</Box>;
};

/** The commit's flags — shown, toggled and explained by the shared `FlagsPanel`. */
const FLAGS: readonly FlagOption[] = [
  {
    flag: '--no-verify',
    label: 'Skip hooks',
    about: 'Commit without running the pre-commit and commit-msg hooks (lint-staged, commitlint…).',
  },
  {
    flag: '--amend',
    label: 'Amend',
    about:
      'Fold the staged changes into the last commit (an empty message keeps its own). Rewrites it — not once pushed.',
  },
  {
    flag: '--allow-empty',
    label: 'Allow empty',
    about: 'Commit even with nothing staged — a marker commit, or one that only re-runs CI.',
  },
  {
    flag: '--signoff',
    label: 'Sign off',
    about: 'Add a "Signed-off-by: <you>" trailer, for projects that ask for a DCO sign-off.',
  },
  {
    flag: '--push',
    label: 'Push after commit',
    about: 'Once the commit succeeds, run giti send — this repository and everything vendored in it.',
  },
];

type Section = 'files' | 'message' | 'flags';

//? How long the message pane stays red after an empty submit
const MESSAGE_ERROR_MS = 2500;

export interface RenderInkCommitOptions {
  initialMessage?: string;
  initialFlags: string[];
  passthroughFlags: string[];
  cwd: string;
  /**
   * How often the file list is re-read even when the watcher saw nothing — the dashboard's
   * Settings value; 0 turns the safety net off and leaves the watcher alone.
   */
  refreshSeconds?: number;
}

export const CommitForm = ({
  cwd,
  initialMessage,
  initialFlags,
  passthroughFlags,
  refreshSeconds = DEFAULT_REFRESH_SECONDS,
  onCommit,
}: RenderInkCommitOptions & { onCommit: (args: string[], push: boolean) => void }) => {
  const { exit } = useApp();
  const colors = useColors();
  //? No `AppShell` here to size the frame, so the form claims the terminal itself: without a
  //? height, the panes stop at their content and the message and flags float up under them
  const { rows } = useTerminalSize();
  const height = Math.max(1, rows - useTuiTheme().sizes.app.heldBackRows);
  const [section, setSection] = useState<Section>('files');
  const [message, setMessage] = useState(initialMessage ?? '');
  const [flags, setFlags] = useState(new Set(initialFlags));
  const [refreshKey, setRefreshKey] = useState(0);
  //? The branch against its remote, as the dashboard reads it — and the top of the work tree,
  //? which is what is watched: `save` may run in a subfolder, and a watch on that alone would
  //? miss every change beside it and in `.git`
  const { snapshot, refresh } = useRepoSnapshot(cwd);
  const root = snapshot?.isRepo ? snapshot.root : undefined;
  const reload = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refresh();
  }, [refresh]);

  //? Kept current the way the dashboard is: an edit saved in another window, a `git add` in a
  //? shell, a commit elsewhere — all show up in the open form rather than on the next one
  useRepoWatch(root, reload);
  //? The dashboard's one quiet fetch on open, so the commits to pull are counted against the
  //? remote as it is now, not as of the last fetch
  const sync = useRemoteSync(root, { notify: (text) => setNotice(text), reload });
  //? The net under the watcher, as on the dashboard: what it missed is on screen within this
  useEffect(() => {
    if (refreshSeconds <= 0) return;
    const id = setInterval(reload, refreshSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshSeconds, reload]);
  const [notice, setNotice] = useState('');
  const [captured, setCaptured] = useState(false);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [staging, setStaging] = useState(false);
  const [quickMessage, setQuickMessage] = useState(false);
  const [messageError, setMessageError] = useState(0);
  //? `TextInput` re-runs `onChange` on every render once edited (its effect depends on our
  //? inline callback), so only a real change may clear the notice — not any re-render
  const lastMessage = useRef(message);
  useEffect(() => {
    if (!messageError) return;
    const timer = setTimeout(() => setMessageError(0), MESSAGE_ERROR_MS);
    return () => clearTimeout(timer);
  }, [messageError]);
  const requireMessage = () => {
    setNotice('Enter a commit message.');
    setMessageError(Date.now());
  };
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
      requireMessage();
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
      //? From another pane Enter only walks to the message; the error is for an empty one submitted
      if (section === 'message') requireMessage();
      else setSection('message');
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
        if (needsMessage) requireMessage();
        else void submit();
      }
      return;
    }
    if (filePreviewOpen) return;
    if (key.escape) return exit();
    if (captured || submitting || staging) return;
    //? Only while no text field has the keys: in the message, `q` is a letter of it
    if (input === 'q' && !key.ctrl && !key.meta && section !== 'message') return exit();
    if (key.return && key.shift) return quickCommit();
    //? The dashboard's keys for the bar on top — except in the message, where they are letters
    if (section !== 'message' && !key.ctrl && !key.meta && snapshot?.isRepo) {
      if (input === 'f') return sync.fetch();
      if (input === 'p') return sync.pull();
      if (input === 'P') return sync.push();
    }
    if (key.tab) {
      const sections: Section[] = ['files', 'message', 'flags'];
      setSection(sections[(sections.indexOf(section) + (key.shift ? 2 : 1)) % 3] ?? 'files');
    } else if (key.return) advance();
    //? The flags' own keys (arrows, Space, digits) are the panel's
  });

  const showMessageError = Boolean(messageError) && !message;
  const messageInput = (
    <MessageField onFocus={() => setSection('message')}>
      <TextInput
        defaultValue={message}
        placeholder={showMessageError ? '' : 'Commit message…'}
        onChange={(value) => {
          if (value === lastMessage.current) return;
          lastMessage.current = value;
          setMessage(value);
          setNotice('');
          setMessageError(0);
        }}
        isDisabled={(!quickMessage && section !== 'message') || captured || submitting}
      />
      {/* In the placeholder's place: `TextInput` greys its own placeholder, so it cannot go red */}
      {showMessageError && <Text color={colors.error}>Commit message required</Text>}
    </MessageField>
  );
  const messageColor = messageError ? colors.error : undefined;

  if (quickMessage) {
    return (
      <Box height={height} justifyContent="center" alignItems="center" paddingX={1}>
        <Box width={72} maxWidth="100%" flexDirection="column">
          <Panel title="Commit message" isFocused color={messageColor}>
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
    <Box flexDirection="column" height={height} paddingX={1}>
      {!filePreviewOpen && (
        <Box flexDirection="column" flexShrink={0}>
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
              {
                hotkey: section === 'message' ? 'Esc' : 'Esc/q',
                label: 'Cancel',
                onPress: exit,
              },
              { hotkey: 'Shift+Enter', label: 'Commit now', onPress: quickCommit },
            ]}
          />
          {snapshot?.isRepo && <SyncBar snapshot={snapshot} sync={sync} />}
          <Text color={colors.accent}>Enter → {nextStep}</Text>
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
        onPreviewModeChange={setFilePreviewOpen}
        onBusyChange={setStaging}
        isInputActive={section === 'files' && !submitting}
      />
      {!filePreviewOpen && (
        //? Pinned at their own height: on a short terminal the panes above give way, not these
        <Box flexDirection="column" flexShrink={0}>
          <Panel
            title="Commit message"
            isFocused={section === 'message'}
            color={messageColor}
          >
            {messageInput}
          </Panel>
          <FlagsPanel
            options={FLAGS}
            on={flags}
            onToggle={toggle}
            focused={section === 'flags' && !captured && !submitting && !staging}
            onFocus={() => setSection('flags')}
            enterLabel="save"
          />
          <Text color={colors.muted} wrap="truncate">
            {notice ||
              (section === 'flags'
                ? `←/→ choose · Space toggle · Tab change focus · Enter → ${nextStep}`
                : `Space stage/unstage · Tab change focus · Enter → ${nextStep}`)}
          </Text>
        </Box>
      )}
    </Box>
  );
};

const renderInkCommit = async (options: RenderInkCommitOptions) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE, refreshSeconds: DEFAULT_REFRESH_SECONDS },
  }).load();
  let selection: { args: string[]; push: boolean } | undefined;
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <CommitForm
        {...options}
        refreshSeconds={config.refreshSeconds}
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

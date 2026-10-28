import { render, Text, useApp, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import PickList, { moveInList, type PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useTerminalSize from '@/dev-tools/ui/hooks/useTerminalSize';
import { TuiThemeProvider, useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import type { SendToTarget } from '../../utils/getSendToTargets';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';

export interface SendToFormProps {
  targets: SendToTarget[];
  /** What is pushed — the checked-out branch, or `HEAD (detached)`. */
  from: string;
  remote: string;
  /** The branch confirmed for the force push; undefined when the user backed out. */
  onDone: (branch: string | undefined) => void;
}

//? The list's frame and title, the warning, toolbar and hint line — what the list leaves to everything else
const CHROME_ROWS = 9;

/**
 * `giti send-to`'s question in two steps: which branch HEAD goes into, then a yes to the force
 * push that replaces it — `y`, or the Force push button. Esc on the question goes back to the list;
 * Esc on the list (or Ctrl+C anywhere) backs out without pushing.
 */
export const SendToForm = ({ targets, from, remote, onDone }: SendToFormProps) => {
  const colors = useColors();
  const { rows } = useTerminalSize();
  const [selected, setSelected] = useState(0);
  const [confirming, setConfirming] = useState<SendToTarget>();

  const items: PickItem<SendToTarget>[] = targets.map((target) => ({
    id: target.name,
    label: target.name,
    tag: target.onRemote ? undefined : 'new',
    hint: target.onRemote
      ? `${target.when} · ${target.subject}`
      : `not on ${remote} yet — the push creates it`,
    value: target,
  }));

  const ask = (index: number) => {
    setSelected(index);
    setConfirming(targets[index]);
  };
  const back = () => setConfirming(undefined);
  const push = () => confirming && onDone(confirming.name);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onDone(undefined);
    if (confirming) {
      if (input === 'y' || input === 'Y') return push();
      if (key.escape || input === 'n') return back();
      return;
    }
    if (key.escape || input === 'q') return onDone(undefined);
    if (key.return) return ask(selected);
    if (key.upArrow || input === 'k') return setSelected((at) => moveInList(items, 1, at, 'up'));
    if (key.downArrow || input === 'j') return setSelected((at) => moveInList(items, 1, at, 'down'));
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <PickList
        title={`Force-push ${from} into a branch of ${remote}`}
        items={items}
        selected={selected}
        isFocused={!confirming}
        visibleRows={Math.max(3, Math.min(items.length, rows - CHROME_ROWS))}
        onSelect={setSelected}
        onActivate={ask}
      />
      {confirming ? (
        <>
          <Text wrap="wrap" color={colors.warn}>
            {confirming.onRemote
              ? `⚠ Force push: ${remote}/${confirming.name} will be replaced by ${from}. Commits only it has are lost on ${remote}.`
              : `⚠ ${remote} has no ${confirming.name} yet — it will be created at ${from}.`}
          </Text>
          <Toolbar
            actions={[
              { hotkey: 'y', label: 'Force push', onPress: push, tone: 'danger' },
              { hotkey: 'Esc', label: 'Back', onPress: back },
            ]}
          />
          <Text color={colors.muted} wrap="truncate">
            Press y (or click Force push) to confirm · Esc picks another branch
          </Text>
        </>
      ) : (
        <>
          <Toolbar
            actions={[
              { hotkey: 'Enter', label: 'Push here…', onPress: () => ask(selected), tone: 'primary' },
              { hotkey: 'Esc', label: 'Cancel', onPress: () => onDone(undefined) },
            ]}
          />
          <Text color={colors.muted} wrap="truncate">
            ↑/↓ move · Enter (or a click on the row) picks · you confirm before anything is pushed
          </Text>
        </>
      )}
    </Box>
  );
};

/** The form as an Ink app of its own: answering it is the end of the app. */
const InlineSendTo = ({ onDone, ...props }: SendToFormProps) => {
  const { exit } = useApp();
  return (
    <SendToForm
      {...props}
      onDone={(branch) => {
        onDone(branch);
        exit();
      }}
    />
  );
};

/**
 * Ask which branch of `remote` to force HEAD into, and for a yes to doing it.
 *
 * Inline rather than full screen, as `hop`'s vendored checklist is: a short question, and the push
 * that follows belongs in the scrollback beneath it.
 *
 * @returns The confirmed branch name; undefined when the user backed out
 */
const renderInkSendTo = async (props: Omit<SendToFormProps, 'onDone'>) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  let picked: string | undefined;
  const { waitUntilExit, unmount, clear } = render(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <InlineSendTo
        {...props}
        onDone={(branch) => {
          picked = branch;
        }}
      />
    </TuiThemeProvider>,
    { exitOnCtrlC: false },
  );
  await waitUntilExit();
  clear();
  unmount();
  return picked;
};

export default renderInkSendTo;

import { type DOMElement, render, Text, useApp, useInput } from 'ink';
import { useRef, useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import { TuiThemeProvider, useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import type { HopAction, VendoredHop } from '../../core/vendoredHop';
import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';

/** What ticking an entry does, as its row says it. */
const ACTION_LABEL: Record<HopAction, string> = {
  switch: 'switch',
  create: 'create branch',
  retarget: 'track branch',
  publish: 'push as branch',
  none: '—',
};

export interface VendoredHopFormProps {
  branch: string;
  entries: VendoredHop[];
  /** The ticked entries on Enter / Apply; empty on Esc / Skip. */
  onDone: (picked: VendoredHop[]) => void;
  /** False while something else on screen has the keyboard. */
  isActive?: boolean;
}

interface HopRowProps {
  entry: VendoredHop;
  width: number;
  isOn: boolean;
  isCursor: boolean;
  /** Clicked: the cursor moves to the row and its tick flips. Absent on a row with nothing to do. */
  onPress?: () => void;
}

const HopRow = ({ entry, width, isOn, isCursor, onPress }: HopRowProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onPress, isActive: Boolean(onPress) });
  const isActionable = entry.action !== 'none';
  const tone = !isActionable
    ? colors.muted
    : entry.kind === 'subrepo' || entry.action === 'create'
      ? colors.warn
      : colors.ok;
  return (
    <Box ref={ref} gap={1}>
      <Text color={colors.highlight}>{isCursor ? '▸' : isHovered ? '›' : ' '}</Text>
      <Text color={isOn ? colors.ok : colors.muted}>
        {isActionable ? (isOn ? '[x]' : '[ ]') : '   '}
      </Text>
      <Text color={colors.muted}>{entry.kind === 'submodule' ? 'module' : 'subrepo'}</Text>
      <Text color={isActionable ? colors.text : colors.muted}>{entry.dir.padEnd(width)}</Text>
      <Text color={colors.muted}>{entry.current || '(detached)'}</Text>
      <Text color={colors.muted}>→</Text>
      <Text color={tone}>{isActionable ? ACTION_LABEL[entry.action] : entry.note}</Text>
      {entry.recommended && <Text color={colors.muted}>(recommended)</Text>}
    </Box>
  );
};

/**
 * The step after a switch: every submodule and subrepo, what following the parent onto its new
 * branch would mean for it, and a tick for the ones to do.
 *
 * The recommended ones (a submodule that already has the branch) start ticked, so Enter alone does
 * the usual thing; creating a branch, or anything touching a subrepo's upstream, is there to tick
 * but never ticked for you. Entries with nothing to do are listed for the picture, not the cursor.
 *
 * Shared by `giti hop` (inline, after its screen closes) and the dashboard's Branches view (in
 * place of the branch list): it only answers through `onDone`, and the host decides what closes.
 */
export const VendoredHopForm = ({
  branch,
  entries,
  onDone,
  isActive = true,
}: VendoredHopFormProps) => {
  const colors = useColors();
  const actionable = entries.filter((entry) => entry.action !== 'none');
  const [cursor, setCursor] = useState(0);
  const recommended = () =>
    new Set(actionable.filter((entry) => entry.recommended).map((entry) => entry.dir));
  const [picked, setPicked] = useState(recommended);

  const finish = (dirs: ReadonlySet<string>) =>
    onDone(actionable.filter((entry) => dirs.has(entry.dir)));
  const toggle = (dir: string) =>
    setPicked((was) => {
      const next = new Set(was);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });

  useInput(
    (input, key) => {
      if (key.escape || input === 'q' || (key.ctrl && input === 'c')) return finish(new Set());
      if (key.return) return finish(picked);
      if (actionable.length === 0) return;
      if (key.upArrow || input === 'k') {
        return setCursor((at) => (at - 1 + actionable.length) % actionable.length);
      }
      if (key.downArrow || input === 'j') return setCursor((at) => (at + 1) % actionable.length);
      if (input === ' ') {
        const entry = actionable[cursor];
        if (entry) toggle(entry.dir);
        return;
      }
      //? `a` ticks every recommended one again after fiddling; `n` clears them all
      if (input === 'a') return setPicked(recommended());
      if (input === 'n') return setPicked(new Set());
    },
    { isActive },
  );

  const focused = actionable[cursor];
  const width = Math.max(...entries.map((entry) => entry.dir.length));
  return (
    <Box flexDirection="column" paddingX={1}>
      <Panel title={`Follow ${branch} in vendored repos`} isFocused={isActive}>
        {entries.map((entry) => {
          const index = actionable.indexOf(entry);
          return (
            <HopRow
              key={`${entry.kind}:${entry.dir}`}
              entry={entry}
              width={width}
              isOn={picked.has(entry.dir)}
              isCursor={entry === focused}
              onPress={
                index < 0 || !isActive
                  ? undefined
                  : () => {
                      setCursor(index);
                      toggle(entry.dir);
                    }
              }
            />
          );
        })}
      </Panel>
      {focused && (
        <Text wrap="wrap" color={colors.muted}>
          <Text color={colors.accent}>{`${focused.dir}: `}</Text>
          {focused.note}
        </Text>
      )}
      <Toolbar
        actions={[
          {
            hotkey: 'Enter',
            label: picked.size ? `Apply ${picked.size}` : 'Done',
            onPress: () => finish(picked),
            tone: 'primary',
          },
          { hotkey: 'Esc', label: 'Skip all', onPress: () => finish(new Set()) },
          ...(actionable.length
            ? [
                { hotkey: 'a', label: 'Recommended', onPress: () => setPicked(recommended()) },
                { hotkey: 'n', label: 'None', onPress: () => setPicked(new Set()) },
              ]
            : []),
        ]}
      />
      <Text color={colors.muted} wrap="truncate">
        {actionable.length
          ? '↑/↓ move · Space (or a click on the row) ticks'
          : 'Nothing to do here · Enter or Esc to finish'}
      </Text>
    </Box>
  );
};

/** The form as an Ink app of its own: answering it is the end of the app. */
const InlineVendoredHop = ({ onDone, ...props }: VendoredHopFormProps) => {
  const { exit } = useApp();
  return (
    <VendoredHopForm
      {...props}
      onDone={(picked) => {
        onDone(picked);
        exit();
      }}
    />
  );
};

/**
 * Ask which vendored repos follow the parent onto `branch`.
 *
 * Inline rather than full screen: it is a short question after the switch, and what was picked —
 * and what happened to it — belongs in the scrollback beneath the switch's own line.
 *
 * @returns The entries ticked; empty when the user skipped
 */
const renderInkVendoredHop = async (branch: string, entries: VendoredHop[]) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  let picked: VendoredHop[] = [];
  const { waitUntilExit, unmount, clear } = render(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <InlineVendoredHop
        branch={branch}
        entries={entries}
        onDone={(chosen) => {
          picked = chosen;
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

export default renderInkVendoredHop;

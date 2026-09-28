import { homedir } from 'node:os';
import { type DOMElement, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

import type {
  ClearOutcome,
  ConfigStore,
  StoreFileInfo,
} from '../../../utils/config/createConfigStore';
import useClickable from '../../hooks/useClickable';
import useLoader from '../../hooks/useLoader';
import { useColors } from '../../providers/TuiThemeProvider';
import ActionButton from '../ActionButton';
import Box from '../Box';
import Panel from '../Panel';
import Toolbar from '../Toolbar';

/** One file the dialog offers to clear. */
export interface ClearTarget {
  id: string;
  /** What it is, in a word or two — "Settings", "State", "This folder's notes". */
  label: string;
  store: Pick<ConfigStore<object>, 'inspect' | 'clear'>;
  /** Ticked when the dialog opens. Defaults to true. */
  checked?: boolean;
  /** One line on what is lost with it. */
  detail?: string;
}

export interface ClearResult {
  id: string;
  label: string;
  path: string;
  outcome: ClearOutcome | 'skipped' | 'failed';
  error?: string;
}

export interface ClearDataDialogProps {
  /** Heads the panel — "Clear porti's settings and state". */
  title: string;
  targets: ClearTarget[];
  /** Called once the ticked files are cleared, with what happened to every target. */
  onDone: (results: ClearResult[]) => void;
  onCancel: () => void;
  /**
   * Told true while the dialog is open. The dialog owns the keyboard: the app's own keys (`q`,
   * the tab digits) must not fire underneath a question about deleting files.
   */
  onCaptureInput?: (captured: boolean) => void;
}

const tildePath = (path: string) => {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

/** How one clear went, in words — for the status line an app shows afterwards. */
export const describeClearResults = (results: ClearResult[]): string => {
  const done = results.filter(
    (result) => result.outcome === 'removed' || result.outcome === 'reset',
  );
  const failed = results.filter((result) => result.outcome === 'failed');
  if (failed.length) {
    return `Could not clear ${failed.map((result) => `${result.label} (${result.error})`).join(', ')}`;
  }
  if (!done.length) return 'Nothing to clear — no files on disk';
  return done
    .map((result) =>
      result.outcome === 'reset'
        ? `${result.label} reset to defaults (${tildePath(result.path)} is linked from dotfiles)`
        : `${result.label} removed (${tildePath(result.path)})`,
    )
    .join(' · ');
};

interface RowProps {
  target: ClearTarget;
  info?: StoreFileInfo;
  checked: boolean;
  isCursor: boolean;
  onToggle: () => void;
}

const Row = ({ target, info, checked, isCursor, onToggle }: RowProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick: onToggle });
  const note = !info
    ? '…'
    : !info.exists
      ? 'not on disk — nothing to remove'
      : info.linked
        ? 'linked from dotfiles — reset to defaults rather than deleted'
        : 'removed from disk';
  return (
    <Box ref={ref} flexDirection="column" marginBottom={1}>
      <Text
        color={isHovered ? colors.highlight : isCursor ? colors.accent : colors.text}
        bold={isCursor}
        wrap="truncate"
      >
        {`${isCursor ? '❯' : ' '} ${checked ? '[×]' : '[ ]'} ${target.label}`}
      </Text>
      <Text color={colors.muted} wrap="truncate-start">
        {`      ${info ? tildePath(info.path) : ''}`}
      </Text>
      <Text color={info?.linked ? colors.warn : colors.muted} wrap="truncate">
        {`      ${checked ? note : 'kept'}${target.detail ? ` · ${target.detail}` : ''}`}
      </Text>
    </Box>
  );
};

/**
 * "Clear everything this app has stored" — the confirmation, the checklist, and the clearing.
 *
 * Every target starts ticked (unless the app says otherwise); only what is still ticked when the
 * user confirms is cleared, each through its store's own `clear`, so a file is removed the same
 * way whichever app asks. Stow-linked files are reset rather than deleted — see
 * `ConfigStore.clear` — and the dialog says so on the row before anything happens.
 *
 * Keys: ↑/↓ move · Space toggle · Enter clear · Esc cancel. Rows and buttons are clickable.
 */
export const ClearDataDialog = ({
  title,
  targets,
  onDone,
  onCancel,
  onCaptureInput,
}: ClearDataDialogProps) => {
  const colors = useColors();
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(targets.filter((target) => target.checked !== false).map((target) => target.id)),
  );
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data: infos } = useLoader(
    () => Promise.all(targets.map((target) => target.store.inspect())),
    [targets.map((target) => target.id).join('|')],
  );

  useEffect(() => {
    onCaptureInput?.(true);
    return () => onCaptureInput?.(false);
  }, [onCaptureInput]);

  const toggle = (id: string | undefined) => {
    if (!id || busy) return;
    setChecked((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (busy || checked.size === 0) return;
    setBusy(true);
    const results: ClearResult[] = [];
    for (const [at, target] of targets.entries()) {
      const path = infos?.[at]?.path ?? (await target.store.inspect()).path;
      if (!checked.has(target.id)) {
        results.push({ id: target.id, label: target.label, path, outcome: 'skipped' });
        continue;
      }
      try {
        results.push({
          id: target.id,
          label: target.label,
          path,
          outcome: await target.store.clear(),
        });
      } catch (error) {
        results.push({
          id: target.id,
          label: target.label,
          path,
          outcome: 'failed',
          error: (error as Error).message,
        });
      }
    }
    onDone(results);
  };

  useInput((input, key) => {
    if (busy) return;
    if (key.escape) onCancel();
    else if (key.upArrow) setCursor((at) => Math.max(0, at - 1));
    else if (key.downArrow) setCursor((at) => Math.min(targets.length - 1, at + 1));
    else if (input === ' ') toggle(targets[cursor]?.id);
    else if (key.return) void confirm();
  });

  const count = checked.size;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Panel title={title} color={colors.error} isFocused>
        <Box marginBottom={1}>
          <Text color={colors.text} wrap="wrap">
            The ticked files are cleared and the app starts over from its defaults. Untick anything
            you want to keep.
          </Text>
        </Box>
        {targets.map((target, at) => (
          <Row
            key={target.id}
            target={target}
            info={infos?.[at]}
            checked={checked.has(target.id)}
            isCursor={at === cursor}
            onToggle={() => {
              setCursor(at);
              toggle(target.id);
            }}
          />
        ))}
        <Box flexDirection="row">
          <ActionButton
            hotkey="Enter"
            label={
              busy
                ? 'Clearing…'
                : count
                  ? `Clear ${count} file${count === 1 ? '' : 's'}`
                  : 'Nothing ticked'
            }
            color={colors.error}
            disabled={busy || count === 0}
            onPress={() => void confirm()}
          />
          <ActionButton hotkey="Esc" label="Cancel" disabled={busy} onPress={onCancel} />
        </Box>
      </Panel>
      <Box marginTop={1}>
        <Text color={colors.muted}>↑/↓ move · Space tick · Enter clear · Esc cancel</Text>
      </Box>
    </Box>
  );
};

/**
 * The button that opens the dialog, for the top of a Settings view's detail pane.
 *
 * There as well as the Reset row at the foot of the settings list: that list is long enough to
 * scroll on an ordinary terminal, and an action nobody can see is an action nobody has. Same key
 * (`X`) in every app, same label, same danger colour.
 */
export const ClearButton = ({ onPress }: { onPress: () => void }) => (
  <Toolbar actions={[{ hotkey: 'X', label: 'Clear settings & state…', onPress, tone: 'danger' }]} />
);

export default ClearDataDialog;

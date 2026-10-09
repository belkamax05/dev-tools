import { Text } from 'ink';
import { useColors } from '../../providers/TuiThemeProvider';
import ActionButton from '../ActionButton';
import Box from '../Box';

export interface ToolbarAction {
  hotkey: string;
  label: string;
  onPress: () => void;
  /**
   * `primary` is what the selected row is most likely there for — drawn in the
   * accent colour and first, so the eye lands on it. `danger` deletes or
   * overwrites something and is drawn in the error colour so it never reads as
   * the obvious next step.
   */
  tone?: 'primary' | 'normal' | 'danger';
  disabled?: boolean;
  /** For a toggle, like Preview — drawn with an on/off marker. */
  isOn?: boolean;
}

/**
 * The actions for whatever the detail pane is showing, as buttons.
 *
 * The same actions are in the hint strip under the list, but a hint strip is a
 * reminder for someone who already knows the keys. This is where a newcomer
 * looks: every button is clickable and carries its key, so it teaches the
 * shortcut on the way. Wraps onto a second line rather than truncating, since
 * a button cut off at the edge is one nobody can find.
 */
export interface ToolbarProps {
  actions: ToolbarAction[];
  /**
   * Lines the pane has for the buttons at most — a cap, for a pane too short to hold a stack.
   * Left off, there is no cap. It is not how the layout is chosen: see `isToolbarStacked`.
   */
  maxRows?: number;
}

/** Up to this many buttons sit in a row; more are stacked. */
const ROW_AT_MOST = 3;

/**
 * Whether a toolbar of `count` buttons is drawn stacked, one per line with the labels aligned.
 *
 * Decided by the buttons alone, never by what else the pane is showing: a toolbar that turned
 * from a column into a row when a toggle beside it gave the pane something else to draw moved
 * every button out from under the pointer. A few buttons fit a row and read at a glance; past
 * that, a wrapped row is a paragraph to search, and a stack is a list to scan.
 */
export const isToolbarStacked = (count: number, maxRows?: number): boolean =>
  count > ROW_AT_MOST && (maxRows === undefined || count <= maxRows);

/**
 * Lines a toolbar takes beyond the single row a pane budgets for it — for a caller sizing
 * whatever sits under it, a diff that scrolls, to the rows that are actually left.
 */
export const toolbarExtraRows = (count: number, maxRows?: number): number =>
  isToolbarStacked(count, maxRows) ? count - 1 : 0;

export const Toolbar = ({ actions, maxRows }: ToolbarProps) => {
  const colors = useColors();
  if (actions.length === 0) return null;
  const stacked = isToolbarStacked(actions.length, maxRows);
  const hotkeyWidth = stacked ? Math.max(...actions.map((action) => action.hotkey.length)) + 3 : 0;
  const ordered = [
    ...actions.filter((action) => action.tone === 'primary'),
    ...actions.filter((action) => action.tone !== 'primary'),
  ];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box
        flexDirection={stacked ? 'column' : 'row'}
        flexWrap={stacked ? 'nowrap' : 'wrap'}
        alignItems="flex-start"
      >
        {ordered.map((action) => (
          <ActionButton
            key={action.hotkey}
            hotkey={action.hotkey}
            hotkeyWidth={hotkeyWidth}
            label={action.tone === 'primary' ? `${action.label} ◂` : action.label}
            isOn={action.isOn}
            disabled={action.disabled}
            color={
              action.tone === 'primary'
                ? colors.accent
                : action.tone === 'danger'
                  ? colors.error
                  : colors.text
            }
            onPress={action.onPress}
          />
        ))}
      </Box>
      <Text color={colors.muted}>{'─'.repeat(40)}</Text>
    </Box>
  );
};

export default Toolbar;

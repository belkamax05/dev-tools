import { Text } from 'ink';

import ActionButton from '../ActionButton';
import Box from '../Box';
import { useColors } from '../../providers/TuiThemeProvider';

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
export const Toolbar = ({ actions }: { actions: ToolbarAction[] }) => {
  const colors = useColors();
  if (actions.length === 0) return null;
  const ordered = [
    ...actions.filter((action) => action.tone === 'primary'),
    ...actions.filter((action) => action.tone !== 'primary'),
  ];
  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" flexWrap="wrap">
        {ordered.map((action) => (
          <ActionButton
            key={action.hotkey}
            hotkey={action.hotkey}
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

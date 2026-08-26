import { Text } from 'ink';
import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import useHoveredId from '../../hooks/useHoveredId';
import { useColors } from '../../providers/TuiThemeProvider';
import ActionButton from '../ActionButton';
import Bar from '../Bar';
import Box from '../Box';

export interface FooterAction {
  id: string;
  label: string;
  /** The key that does the same thing. */
  hotkey?: string;
  /** Toggle state, where the action has one. */
  isOn?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Replaces the hint text while the pointer is over this action. */
  tooltip?: string;
}

export interface FooterProps {
  /** Plain text shown to the left of the actions — navigation, mostly. */
  hints?: ReactNode;
  /** Clickable buttons on the right. */
  actions?: FooterAction[];
  /** Told what the pointer is over, so the caller can explain it. */
  onHoverAction?: (action: FooterAction | null) => void;
}

/**
 * The bottom bar: what you can do, and how.
 *
 * The actions are buttons rather than a sentence naming keys, because a hint
 * that reads `[K]ey` is only useful to someone who already knows the app —
 * anyone else has to guess whether the bracket is a key to press or decoration.
 * Clicking one does what typing its key does, and the key is still printed on it.
 */
export const Footer = ({
  hints = 'Nav: [Tab] switch · [↑/↓/←/→] move · [Enter] select · [q] quit',
  actions = [],
  onHoverAction,
}: FooterProps) => {
  const colors = useColors();
  const [hoveredId, reportHover] = useHoveredId<string>();

  //? Both held in refs so the effect fires on a real hover change and nothing
  //? else: the caller builds `actions` inline, so it is a new array every render,
  //? and as a dependency it would re-notify on every keystroke in the app.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const onHoverActionRef = useRef(onHoverAction);
  onHoverActionRef.current = onHoverAction;

  useEffect(() => {
    onHoverActionRef.current?.(
      actionsRef.current.find((action) => action.id === hoveredId) ?? null,
    );
  }, [hoveredId]);

  return (
    <Bar color={colors.muted} marginTop={1} width="100%" justifyContent="space-between">
      <Box flexShrink={1}>
        {typeof hints === 'string' ? (
          <Text color={colors.muted} wrap="truncate">
            {hints}
          </Text>
        ) : (
          hints
        )}
      </Box>

      {actions.length > 0 && (
        //? flexShrink 0: the buttons are the part you can click, so on a narrow
        //? terminal it is the hint text that gives up columns, not them.
        <Box flexShrink={0}>
          {actions.map((action) => (
            <ActionButton
              key={action.id}
              hotkey={action.hotkey}
              label={action.label}
              isOn={action.isOn}
              disabled={action.disabled}
              onPress={action.onPress}
              onHover={(hovered) => reportHover(action.id, hovered)}
            />
          ))}
        </Box>
      )}
    </Bar>
  );
};

export default Footer;

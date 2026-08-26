import { type DOMElement, Text } from 'ink';
import { useEffect, useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface ActionButtonProps {
  /**
   * The key that does the same thing, drawn in brackets before the label.
   *
   * Shown even though the button is clickable: the bracket is what teaches the
   * shortcut, and a control that can only be reached with the mouse is a step
   * backwards in a terminal app.
   */
  hotkey?: string;
  label: string;
  /**
   * Toggle or radio state. Omit entirely for a button that just does something —
   * an action drawn with an empty checkbox reads as "off", which is a state it
   * does not have.
   */
  isOn?: boolean;
  disabled?: boolean;
  /** Accent when idle and not selected. Defaults to the theme's muted colour. */
  color?: string;
  onPress: () => void;
  /** Told when the pointer enters and leaves, for a caller's status line. */
  onHover?: (hovered: boolean) => void;
}

/**
 * A label you can click or type the key of.
 *
 * A footer toggle and a settings row are the same widget: a word, the key that
 * triggers it, sometimes a state, and a highlight under the pointer. Hover is
 * drawn rather than left to the cursor shape because only kitty can change that
 * (OSC 22) — everywhere else the highlight is the only feedback a pointer gets.
 */
export const ActionButton = ({
  hotkey,
  label,
  isOn,
  disabled = false,
  //? No default in the signature: the fallback is a theme colour, and a default
  //? parameter is evaluated before the hook that knows what the theme is.
  color,
  onPress,
  onHover,
}: ActionButtonProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, {
    onClick: () => {
      if (!disabled) onPress();
    },
    isActive: !disabled,
  });

  //? Held in a ref so the effect below depends on `isHovered` alone.
  //?
  //? Callers write `onHover` inline, so its identity changes on every render. As
  //? an effect dependency that made every button re-report on every render —
  //? including all the ones saying "not me", which then raced the one button
  //? saying "me" and usually won. Reporting only on a real transition is what
  //? makes a hover hint stay on screen.
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    onHoverRef.current?.(isHovered);
  }, [isHovered]);

  const textColor = disabled
    ? colors.muted
    : isHovered
      ? colors.accentText
      : isOn
        ? colors.accent
        : (color ?? colors.muted);

  //? Marked as well as coloured: "on" has to survive a terminal with no colour
  //? and a reader who cannot tell cyan from grey.
  //?
  //? One glyph rather than a `[×]` checkbox, because the hotkey next to it is
  //? already in brackets — two bracketed groups in a row and neither one reads
  //? as the key you are meant to press.
  const marker = isOn === undefined ? '' : isOn ? '▣ ' : '▢ ';

  return (
    <Box
      ref={ref}
      marginRight={1}
      backgroundColor={isHovered && !disabled ? colors.accent : undefined}
    >
      <Text color={textColor} bold={isOn} dimColor={disabled}>
        {marker}
        {hotkey === undefined ? '' : `[${hotkey}] `}
        {label}
      </Text>
    </Box>
  );
};

export default ActionButton;

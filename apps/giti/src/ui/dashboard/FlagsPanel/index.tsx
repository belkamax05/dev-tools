import { Text, useInput } from 'ink';
import { useState } from 'react';

import ActionButton from '@/dev-tools/ui/components/ActionButton';
import Box from '@/dev-tools/ui/components/Box';
import Panel from '@/dev-tools/ui/components/Panel';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

/** One flag: what reaches git, its button, and what it does — shown for the one under the cursor. */
export interface FlagOption {
  flag: string;
  label: string;
  about: string;
}

export interface FlagsPanelProps {
  options: readonly FlagOption[];
  on: ReadonlySet<string>;
  onToggle: (flag: string) => void;
  /** The panel has the keyboard: the cursor is drawn and its keys work. */
  focused: boolean;
  /** Give the panel the keyboard — a click on a flag does, as Tab reaching it does. */
  onFocus: () => void;
  /** What Enter does from here — the owner's, named in the title: "save", "switch". */
  enterLabel: string;
  /**
   * Only the toggles, in a frame: no title row of keys and no line explaining the flag. For a
   * form on a short terminal that names the keys itself — every row it saves goes to the list.
   */
  compact?: boolean;
}

/**
 * A command's flags as a row of toggles, with the one under the cursor (or the pointer) explained
 * underneath — the same panel in every form that has flags (`save`, `hop`).
 *
 * ←/→ (and ↑/↓) move the cursor, wrapping; Space toggles the flag under it; a digit toggles
 * that flag outright. Enter belongs to the form around it.
 */
export const FlagsPanel = ({
  options,
  on,
  onToggle,
  focused,
  onFocus,
  enterLabel,
  compact = false,
}: FlagsPanelProps) => {
  const colors = useColors();
  //? The flag the arrows are on, and the one the pointer is over — that one is explained first
  const [cursor, setCursor] = useState(0);
  const [hovered, setHovered] = useState<number>();

  useInput(
    (input, key) => {
      const step = key.leftArrow || key.upArrow ? -1 : key.rightArrow || key.downArrow ? 1 : 0;
      if (step) {
        setCursor((at) => (at + step + options.length) % options.length);
        return;
      }
      if (input === ' ') {
        const option = options[cursor];
        if (option) onToggle(option.flag);
        return;
      }
      const index = Number(input) - 1;
      const option = options[index];
      if (option) {
        setCursor(index);
        onToggle(option.flag);
      }
    },
    { isActive: focused },
  );

  const shown = options[hovered ?? cursor] ?? options[0];
  return (
    <Panel
      title={
        compact
          ? undefined
          : `Flags · ←/→ choose · Space or 1–${options.length} toggle · Enter to ${enterLabel}`
      }
      isFocused={focused}
    >
      <Box flexDirection="row" flexWrap="wrap">
        {options.map((option, index) => (
          <ActionButton
            key={option.flag}
            hotkey={String(index + 1)}
            //? The cursor is drawn only while the panel has the keys, as a list's is
            label={`${focused && index === cursor ? '▸' : ''}${option.label}`}
            color={focused && index === cursor ? colors.highlight : undefined}
            isOn={on.has(option.flag)}
            onHover={(over) => setHovered((was) => (over ? index : was === index ? undefined : was))}
            onPress={() => {
              onFocus();
              setCursor(index);
              onToggle(option.flag);
            }}
          />
        ))}
      </Box>
      {shown && !compact && (
        <Text wrap="wrap">
          <Text color={focused ? colors.accent : colors.muted}>
            {`${shown.label} (${shown.flag}${on.has(shown.flag) ? ', on' : ''}): `}
          </Text>
          <Text color={colors.muted}>{shown.about}</Text>
        </Text>
      )}
    </Panel>
  );
};

export default FlagsPanel;

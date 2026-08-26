import { type DOMElement, Text } from 'ink';
import { useEffect, useRef } from 'react';

import useClickable from '../../hooks/useClickable';
import useHoveredId from '../../hooks/useHoveredId';
import { useColors } from '../../providers/TuiThemeProvider';
import Box from '../Box';

export interface Chip {
  id: string;
  label: string;
  isOn?: boolean;
  disabled?: boolean;
  /** Shown in the caller's status line while the pointer is over the chip. */
  tooltip?: string;
}

/** Cells a chip takes: its marker, a space, the label, and the gap after it. */
export const chipWidth = (chip: Chip, compact = false): number =>
  (compact ? 1 : 3) + 1 + chip.label.length + 1;

interface ChipButtonProps {
  chip: Chip;
  /** Drop the brackets to a single glyph, for a row that would otherwise wrap. */
  compact?: boolean;
  onClick: () => void;
  /** Only ever about this chip — the row decides which one that makes current. */
  onHover: (isHovered: boolean) => void;
}

/**
 * One toggle. Marked rather than coloured alone, because "on" has to survive a
 * terminal with no colour at all and a reader who cannot tell cyan from white.
 */
const ChipButton = ({ chip, compact = false, onClick, onHover }: ChipButtonProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered } = useClickable(ref, { onClick, isActive: !chip.disabled });

  //? Held in a ref so the effect depends on `isHovered` alone. `onHover` is
  //? written inline by the caller and `chip` is rebuilt every render, so as
  //? dependencies they made every chip re-report on every render — see
  //? `useHoveredId` for why that blanks the tooltip it was meant to show.
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    onHoverRef.current(isHovered);
  }, [isHovered]);

  const color = chip.disabled
    ? colors.muted
    : isHovered
      ? colors.highlight
      : chip.isOn
        ? colors.accent
        : colors.text;

  return (
    <Box ref={ref} marginRight={1}>
      <Text color={color} bold={chip.isOn} dimColor={chip.disabled}>
        {compact ? (chip.isOn ? '▣' : '▢') : chip.isOn ? '[×]' : '[ ]'} {chip.label}
      </Text>
    </Box>
  );
};

export interface ChipRowProps {
  label?: string;
  chips: Chip[];
  /**
   * Shrink each chip's marker from `[ ]` to one glyph.
   *
   * Worth two cells a chip, which is the difference between one line and two for
   * five modifiers at 60 columns — and a second line is a row the view has to
   * budget for at exactly the size where it has none to spare.
   */
  compact?: boolean;
  onToggle: (id: string) => void;
  onHover?: (chip: Chip | null) => void;
}

/**
 * A row of toggles — the held modifiers of a shortcut, a set of flags.
 *
 * A GUI draws these as checkboxes in a form; a terminal has none, and a vertical
 * list of ten one-word options wastes ten rows to say what one row can.
 * Horizontal is not a compromise here, it is the better fit.
 */
export const ChipRow = ({ label, chips, compact = false, onToggle, onHover }: ChipRowProps) => {
  const colors = useColors();
  //? Tracked by id here rather than left to the chips: each one only knows
  //? whether the pointer is on itself, and the last to say "no" would otherwise
  //? erase the one that just said "yes".
  const [hoveredId, reportHover] = useHoveredId<string>();

  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    onHoverRef.current?.(chipsRef.current.find((chip) => chip.id === hoveredId) ?? null);
  }, [hoveredId]);

  return (
    <Box flexDirection="row" flexWrap="wrap">
      {label !== undefined && (
        <Box marginRight={1}>
          <Text color={colors.muted}>{label}</Text>
        </Box>
      )}
      {chips.map((chip) => (
        <ChipButton
          key={chip.id}
          chip={chip}
          compact={compact}
          onClick={() => {
            if (!chip.disabled) onToggle(chip.id);
          }}
          onHover={(hovered) => reportHover(chip.id, hovered)}
        />
      ))}
    </Box>
  );
};

export default ChipRow;

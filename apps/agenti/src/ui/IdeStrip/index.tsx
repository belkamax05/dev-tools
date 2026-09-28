import { type DOMElement, Text } from 'ink';
import { useEffect, useRef } from 'react';

import { graphicsSupport } from '@/dev-tools/terminal-canvas';
import Box from '@/dev-tools/ui/components/Box';
import useClickable from '@/dev-tools/ui/hooks/useClickable';
import useHoveredId from '@/dev-tools/ui/hooks/useHoveredId';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors, useTuiTheme } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { findIdeBinary, IDES, type IdeDefinition } from '../../core/ides';
import { type LogoMode, resolveLogoTechnique } from '../logo';
import IdeLogo from '../logo/IdeLogo';
import { IDE_STRIP_ROWS } from '../theme';

/** The logo's box: two rows are about four columns square. */
const LOGO_COLS = 4;

/**
 * Kitty ids for the strip's logos, one per IDE. Clear of the 9001 every lone
 * image uses — Settings' own logo among them — so none replaces another.
 */
const IMAGE_ID_BASE = 9100;

/** Shift and the digit: the IDE's place in the strip, pressed with Shift. */
export const IDE_STRIP_KEYS = ['!', '@', '#', '$', '%', '^', '&', '*', '('] as const;

const stateLabel = (isOn: boolean, isPrimary: boolean, isHolding = false) =>
  isHolding && !isPrimary ? '◔ hold…' : isPrimary ? '▣ primary' : isOn ? '▣ on' : '▢ off';

/** Cells a chip takes: the logo and the space after it, the wider of its two lines, the gap. */
const chipWidth = (ide: IdeDefinition, withLogo: boolean) =>
  (withLogo ? LOGO_COLS + 1 : 0) + Math.max(ide.name.length, stateLabel(true, true).length) + 2;

interface ChipProps {
  ide: IdeDefinition;
  index: number;
  isOn: boolean;
  isPrimary: boolean;
  isShown: boolean;
  /** Where the keyboard is, while the strip has it. */
  isFocused: boolean;
  logoMode: LogoMode | undefined;
  onToggle: () => void;
  onMakePrimary: () => void;
  onHover: (isHovered: boolean) => void;
}

const Chip = ({
  ide,
  index,
  isOn,
  isPrimary,
  isShown,
  isFocused,
  logoMode,
  onToggle,
  onMakePrimary,
  onHover,
}: ChipProps) => {
  const colors = useColors();
  const ref = useRef<DOMElement>(null);
  const { isHovered, isHolding } = useClickable(ref, {
    onClick: onToggle,
    onLongPress: onMakePrimary,
  });

  //? In a ref, so the effect runs on a real hover change only — see ChipRow
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  useEffect(() => {
    onHoverRef.current(isHovered);
  }, [isHovered]);

  const installed = Boolean(findIdeBinary(ide));
  const nameColor = isHovered
    ? colors.highlight
    : isShown
      ? colors.accent
      : isOn
        ? colors.text
        : colors.muted;

  return (
    <Box ref={ref} flexDirection="row" marginRight={2} flexShrink={0}>
      {logoMode && (
        <Box width={LOGO_COLS} height={IDE_STRIP_ROWS} marginRight={1} flexShrink={0}>
          <IdeLogo
            ide={ide}
            mode={logoMode}
            maxCols={LOGO_COLS}
            maxRows={IDE_STRIP_ROWS}
            imageId={IMAGE_ID_BASE + index}
          />
        </Box>
      )}
      <Box flexDirection="column">
        <Text
          color={nameColor}
          bold={isShown}
          underline={isShown}
          inverse={isFocused}
          dimColor={!installed && !isOn}
          wrap="truncate"
        >
          {ide.name}
        </Text>
        <Text color={isHolding ? colors.warn : isOn ? colors.ok : colors.muted} wrap="truncate">
          {stateLabel(isOn, isPrimary, isHolding)}
        </Text>
      </Box>
    </Box>
  );
};

export interface IdeStripProps {
  /** The IDEs this scope is kept in step with; the first is primary. */
  ides: IdeDefinition[];
  /** The one the tabs are showing. */
  shownId: string;
  logoMode: LogoMode;
  /** The IDE the keyboard is on, while the strip has it (`I`); undefined otherwise. */
  focusedId?: string;
  onToggle: (id: string) => void;
  /** A long press: keep it in step, first. */
  onMakePrimary: (id: string) => void;
  /** A line for the footer while the pointer is over a chip, and null once it leaves. */
  onHint: (hint: string | null) => void;
}

/**
 * Every IDE agenti knows, under the tabs, each a toggle for whether this scope
 * is kept in step with it — the same list, and the same switch, as the IDE
 * section of Settings, reachable from every tab. A click toggles, a long press
 * makes primary; with the keyboard, `I` moves into the strip (see App).
 *
 * Logos are drawn as in Settings: real pixels over kitty where the terminal has
 * it, braille otherwise. ASCII at four cells says nothing, so there the strip is
 * names alone — as it is on a terminal too narrow for a logo per IDE.
 */
export const IdeStrip = ({
  ides,
  shownId,
  logoMode,
  focusedId,
  onToggle,
  onMakePrimary,
  onHint,
}: IdeStripProps) => {
  const theme = useTuiTheme();
  const viewport = useViewport();
  const [hoveredId, reportHover] = useHoveredId<string>();

  const onHintRef = useRef(onHint);
  onHintRef.current = onHint;
  //? A string, not the array: `ides` is rebuilt on every render of the app, and
  //? an effect on it would clear the footer's own tooltip each time it showed
  const onIds = ides.map((one) => one.id).join(',');
  useEffect(() => {
    const ide = IDES.find((candidate) => candidate.id === hoveredId);
    if (!ide) return onHintRef.current(null);
    const isOn = onIds.split(',').includes(ide.id);
    const key = IDE_STRIP_KEYS[IDES.indexOf(ide)];
    onHintRef.current(
      `Click: ${isOn ? `stop keeping ${ide.name} in step` : `keep ${ide.name} in step too`}${key ? ` [${key}]` : ''} · hold: make primary`,
    );
  }, [hoveredId, onIds]);

  const appWidth = Math.max(
    viewport.columns - theme.sizes.app.horizontalMargin,
    theme.sizes.app.minWidth,
  );
  const technique = resolveLogoTechnique(logoMode, graphicsSupport());
  const logosFit =
    IDES.reduce((total, ide) => total + chipWidth(ide, true), 0) <= appWidth &&
    technique.id !== 'ascii';

  return (
    <Box flexDirection="row" height={IDE_STRIP_ROWS} overflow="hidden">
      {IDES.map((ide, index) => (
        <Chip
          key={ide.id}
          ide={ide}
          index={index}
          isOn={ides.some((one) => one.id === ide.id)}
          isPrimary={ides[0]?.id === ide.id}
          isShown={ide.id === shownId}
          isFocused={ide.id === focusedId}
          logoMode={logosFit ? logoMode : undefined}
          onToggle={() => onToggle(ide.id)}
          onMakePrimary={() => onMakePrimary(ide.id)}
          onHover={(isHovered) => reportHover(ide.id, isHovered)}
        />
      ))}
    </Box>
  );
};

export default IdeStrip;

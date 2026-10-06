import { type DOMElement, Text } from 'ink';
import { useMemo, useRef } from 'react';

import {
  bestTechnique,
  graphicsSupport,
  type RasterTechnique,
} from '../../../terminal-canvas/index.ts';
import useRasterOverlay from '../../hooks/useRasterOverlay';
import type { ColorRole, Palette } from '../../theme';
import Box from '../Box';
import paletteSubject, { DISC_ROLES } from './paletteSubject';

/** One kitty image id for every swatch: only one is ever on screen, in a detail pane. */
const SWATCH_IMAGE_ID = 7301;

/** Rows the picture takes where it is a picture — tall enough for the discs to read as round. */
const RASTER_ROWS = 3;

export interface PaletteSwatchProps {
  colors: Palette;
  /** The role to single out — the one an editor's cursor is on. */
  focus?: ColorRole;
  /** Cells across. The picture is centred in it; the text form takes what it needs. */
  width: number;
}

/** Rows a swatch takes at `width` on this terminal — for a caller budgeting its height. */
export const paletteSwatchRows = (focus?: ColorRole): number =>
  bestTechnique(graphicsSupport()).kind === 'raster' ? RASTER_ROWS : focus ? 2 : 1;

/**
 * A palette at a glance.
 *
 * Where the terminal draws pixels (kitty, sixel, iTerm2) it is a picture: the colours as shaded
 * discs on a card of the palette's own background — see `paletteSubject`. Everywhere else it is
 * text, which is no worse at the job: a row of colour blocks on that background, the accent's
 * as a sample of accent text, and a marker under the focused one. Text also resolves ANSI names
 * through the terminal's own palette, which the picture can only approximate.
 */
export const PaletteSwatch = ({ colors, focus, width }: PaletteSwatchProps) => {
  const ref = useRef<DOMElement>(null);
  const support = graphicsSupport();
  const technique = bestTechnique(support);
  const raster = technique.kind === 'raster' ? (technique as RasterTechnique) : undefined;
  const subject = useMemo(() => paletteSubject(colors, focus), [colors, focus]);

  useRasterOverlay({
    technique: raster,
    subject,
    time: 0,
    animating: false,
    target: ref,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
    imagesInCells: support.imagesInCells,
    imageId: SWATCH_IMAGE_ID,
  });

  if (raster) {
    return <Box ref={ref} width={Math.max(8, width)} height={RASTER_ROWS} flexShrink={0} />;
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Box>
        <Box backgroundColor={colors.surface} paddingX={1}>
          {DISC_ROLES.map((role) => (
            <Text
              key={role}
              color={role === 'accent' ? colors.accentText : colors[role]}
              backgroundColor={role === 'accent' ? colors.accent : undefined}
              bold={role === 'accent'}
            >
              {role === 'accent' ? 'Aa' : '██'}{' '}
            </Text>
          ))}
        </Box>
      </Box>
      {focus && (
        <Text color={colors.text}>
          {' '}
          {DISC_ROLES.map((role) =>
            role === focus || (role === 'accent' && focus === 'accentText') ? '▔▔ ' : '   ',
          ).join('')}
          {focus === 'surface' ? '← background' : ''}
        </Text>
      )}
    </Box>
  );
};

export default PaletteSwatch;

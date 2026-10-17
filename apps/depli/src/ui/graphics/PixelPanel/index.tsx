import type { DOMElement } from 'ink';
import { useMemo, useRef } from 'react';

import {
  bestTechnique,
  graphicsSupport,
  type PixelSurface,
  type RasterTechnique,
  type Subject,
} from '@/dev-tools/terminal-canvas';
import GraphicsCanvas from '@/dev-tools/ui/components/GraphicsCanvas';
import useRasterOverlay from '@/dev-tools/ui/hooks/useRasterOverlay';

export interface PixelPanelProps {
  /** Changes whenever the picture does — the overlay redraws on a new id, not on every render. */
  id: string;
  cols: number;
  rows: number;
  draw: (surface: PixelSurface, time: number) => void;
  /** Seconds, for a subject that moves (a pulse on a running step). */
  time?: number;
  animated?: boolean;
  /** Distinct per panel on screen, so one placement never replaces another. */
  overlayId: number;
}

/**
 * A picture at the terminal's best fidelity: kitty / sixel / iTerm2 paint real pixels over a
 * reserved rectangle; anywhere else the same drawing comes out as half-block characters. The
 * drawing code is the same either way.
 */
export const PixelPanel = ({
  id,
  cols,
  rows,
  draw,
  time = 0,
  animated = false,
  overlayId,
}: PixelPanelProps) => {
  const ref = useRef<DOMElement>(null);
  const support = graphicsSupport();
  const technique = bestTechnique(support);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id stands for what draw draws
  const subject = useMemo<Subject>(
    () => ({ id, label: id, note: '', animated, lineArt: true, draw }),
    [id, animated],
  );
  const raster = technique.kind === 'raster' ? (technique as RasterTechnique) : undefined;

  useRasterOverlay({
    technique: raster,
    imageId: overlayId,
    subject,
    time,
    animating: animated,
    target: ref,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
    imagesInCells: support.imagesInCells,
  });

  return (
    <GraphicsCanvas
      ref={ref}
      technique={technique}
      subject={subject}
      time={time}
      cols={cols}
      rows={rows}
    />
  );
};

export default PixelPanel;

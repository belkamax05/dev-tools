import type { DOMElement } from 'ink';
import { type RefObject, useMemo } from 'react';

import {
  bestTechnique,
  encodeKittyImage,
  graphicsSupport,
  type GraphicsSupport,
  type RasterTechnique,
  type Subject,
} from '@/dev-tools/terminal-canvas';
import useRasterOverlay from '@/dev-tools/ui/hooks/useRasterOverlay';
import { drawFrame } from './drawFrame';

/** Cell-backed images in xterm.js cannot provide a reliable layer beneath live text. */
export const supportsJobFrame = (support: GraphicsSupport = graphicsSupport()) =>
  !support.imagesInCells && bestTechnique(support).id === 'kitty';

export interface JobFrameProps {
  target: RefObject<DOMElement | null>;
  color: string;
  opacity: number;
  overlayId: number;
  tee: number;
  joinTop: boolean;
  joinBottom: boolean;
}

const technique: RasterTechnique = {
  id: 'kitty-job-frame',
  label: 'Job frame',
  note: '',
  kind: 'raster',
  supported: (support) => support.kitty,
  scalesToCellBox: true,
  encode: (surface, cols, rows, id) =>
    encodeKittyImage(surface.rgba, surface.width, surface.height, {
      cols,
      rows,
      id,
      zIndex: -1,
      preserveCursor: true,
    }),
};

/** Draw border and translucent fill as one shape, behind the existing text and provider icons. */
export const JobFrame = ({
  target,
  color,
  opacity,
  overlayId,
  tee,
  joinTop,
  joinBottom,
}: JobFrameProps) => {
  const support = graphicsSupport();
  const subject = useMemo<Subject>(
    () => ({
      id: `job-frame:${color}:${opacity}:${tee}:${joinTop}:${joinBottom}:${support.cellWidth}:${support.cellHeight}`,
      label: 'Job frame',
      note: '',
      animated: false,
      lineArt: true,
      draw: (surface) =>
        drawFrame(surface, {
          color,
          opacity,
          cellWidth: support.cellWidth,
          cellHeight: support.cellHeight,
          tee,
          joinTop,
          joinBottom,
        }),
    }),
    [color, opacity, tee, joinTop, joinBottom, support.cellWidth, support.cellHeight],
  );
  useRasterOverlay({
    technique,
    subject,
    time: 0,
    animating: false,
    target,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
    imageId: overlayId,
    imagesInCells: support.imagesInCells,
  });
  return null;
};

export default JobFrame;

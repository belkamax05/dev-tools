import { type DOMElement, Text } from 'ink';
import { useMemo, useRef } from 'react';

import {
  bestTechnique,
  drawImage,
  graphicsSupport,
  type RasterTechnique,
  type Subject,
} from '@/dev-tools/terminal-canvas';
import GraphicsCanvas from '@/dev-tools/ui/components/GraphicsCanvas';
import useRasterOverlay from '@/dev-tools/ui/hooks/useRasterOverlay';

import type { DecodedImage } from '../../core/icon';

export interface FaviconProps {
  image: DecodedImage | undefined;
  fallback: string[] | undefined;
  cols: number;
  rows: number;
  muted: string;
}

/** A compact content signature so the overlay redraws when an equally sized icon replaces it. */
const imageId = (image: DecodedImage | undefined) => {
  if (!image) return 'blank';
  let hash = 2_166_136_261;
  for (const byte of image.rgba) hash = Math.imul(hash ^ byte, 16_777_619);
  return `${image.width}x${image.height}:${hash >>> 0}`;
};

/**
 * A favicon at the terminal's best available fidelity.
 *
 * Graphics protocols reserve the same Ink rectangle as the text fallback, then
 * paint the source RGBA pixels over it after Ink writes the frame. This keeps
 * transparency intact in kitty (and other raster-capable terminals) without
 * leaving a stale placement when the selected bookmark changes.
 */
export const Favicon = ({ image, fallback, cols, rows, muted }: FaviconProps) => {
  const ref = useRef<DOMElement>(null);
  const support = graphicsSupport();
  const technique = bestTechnique(support);
  const subject = useMemo<Subject>(
    () => ({
      id: `favicon:${imageId(image)}`,
      label: 'Favicon',
      note: '',
      animated: false,
      draw: (surface) => {
        if (image) drawImage(surface, image);
      },
    }),
    [image],
  );
  const raster = technique.kind === 'raster' && image ? (technique as RasterTechnique) : undefined;

  useRasterOverlay({
    technique: raster,
    subject,
    time: 0,
    animating: false,
    target: ref,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
    imagesInCells: support.imagesInCells,
  });

  if (raster) {
    return <GraphicsCanvas ref={ref} technique={raster} subject={subject} time={0} cols={cols} rows={rows} />;
  }

  return fallback ? (
    fallback.map((line) => (
      <Text key={line} wrap="truncate">
        {line}
      </Text>
    ))
  ) : (
    Array.from({ length: rows }, (_, row) => ({
      key: `placeholder:${row}`,
      line: row === 1 ? '  ····  ' : ' ',
    })).map(({ key, line }) => (
      <Text key={key} color={muted}>
        {line}
      </Text>
    ))
  );
};

export default Favicon;

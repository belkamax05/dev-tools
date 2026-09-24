import type { DOMElement } from 'ink';
import { useRef } from 'react';

import GraphicsCanvas from '@/dev-tools/ui/components/GraphicsCanvas';
import useRasterOverlay from '@/dev-tools/ui/hooks/useRasterOverlay';
import {
  fitFootprint,
  graphicsSupport,
  type RasterTechnique,
  type Subject,
} from '@/dev-tools/terminal-canvas';

import type { IdeDefinition } from '../../core/ides';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { type LogoMode, loadLogo, resolveLogoTechnique } from '.';

/** Drawn while the PNG decodes, and for an IDE whose logo is missing: nothing. */
const BLANK: Subject = {
  id: 'blank',
  label: '',
  note: '',
  animated: false,
  draw: () => {},
};

export interface IdeLogoProps {
  ide: IdeDefinition;
  mode: LogoMode;
  /** The most the logo may take; it is fitted inside, keeping its shape. */
  maxCols: number;
  maxRows: number;
}

/**
 * An IDE's logo, drawn with the best technique the terminal offers.
 *
 * Text techniques are just rows of characters in the layout. A raster one
 * (kitty) reserves the same rectangle blank and has `useRasterOverlay` paint the
 * image over it after Ink has drawn — Ink cannot lay out an image itself.
 */
export const IdeLogo = ({ ide, mode, maxCols, maxRows }: IdeLogoProps) => {
  const ref = useRef<DOMElement>(null);
  const { data: subject } = useLoader(() => loadLogo(ide), [ide.id]);
  const support = graphicsSupport();
  const technique = resolveLogoTechnique(mode, support);
  const drawn = subject ?? BLANK;
  const { cols, rows } = fitFootprint(maxCols, maxRows, drawn.aspect ?? 1);

  useRasterOverlay({
    technique: technique.kind === 'raster' && subject ? (technique as RasterTechnique) : undefined,
    subject: drawn,
    time: 0,
    animating: false,
    target: ref,
    cellWidth: support.cellWidth,
    cellHeight: support.cellHeight,
  });

  if (maxCols < 4 || maxRows < 2) return null;
  return (
    <GraphicsCanvas
      ref={ref}
      technique={technique}
      subject={drawn}
      time={0}
      cols={cols}
      rows={rows}
    />
  );
};

export default IdeLogo;

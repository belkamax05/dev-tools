import createBrailleCanvas from './createBrailleCanvas.ts';
import createCellCanvas from './createCellCanvas.ts';
import createHalfBlockCanvas from './createHalfBlockCanvas.ts';
import type { RasterCanvas } from './createRasterCanvas.ts';
import createSextantCanvas from './createSextantCanvas.ts';
import type { GraphicsSupport } from './detectGraphicsSupport.ts';
import encodeKittyImage from './encodeKittyImage.ts';
import encodePng from './encodePng.ts';
import encodeSixelImage from './encodeSixelImage.ts';
import type { PixelCanvas } from './pixelCanvas.ts';

/**
 * The two families differ in one way that drives the whole app.
 *
 * A `text` technique resolves to characters, so Ink can lay it out like any
 * other string. A `raster` technique hands bytes straight to the terminal; Ink
 * measures those as zero width and paints over them, so they have to be written
 * on top of the frame at an absolute position — see useRasterOverlay.ts.
 */
export type TechniqueKind = 'text' | 'raster';

export interface TextTechnique {
  id: string;
  label: string;
  note: string;
  kind: 'text';
  create: (cols: number, rows: number) => PixelCanvas;
}

export interface RasterTechnique {
  id: string;
  label: string;
  note: string;
  kind: 'raster';
  supported: (support: GraphicsSupport) => boolean;
  /**
   * Whether the protocol is told the footprint in *cells* and scales the pixels
   * to fit it, rather than laying them out one device pixel at a time.
   *
   * Where it does, the pixel buffer's resolution is a quality dial and nothing
   * else: a caller can hand it half as many pixels and get the same rectangle,
   * slightly softer. Where it does not — sixel — the same buffer comes out half
   * the size on screen, so the resolution is the layout and cannot be traded.
   */
  scalesToCellBox: boolean;
  /** Escape sequence that paints the image into exactly `cols` x `rows` cells. */
  encode: (raster: RasterCanvas, cols: number, rows: number) => string;
}

export type Technique = TextTechnique | RasterTechnique;

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/**
 * A fixed image id so re-transmitting replaces the previous frame instead of
 * stacking a new placement on top of it. Deleting and re-sending also works but
 * costs an extra round trip per frame.
 */
const KITTY_IMAGE_ID = 9001;

export const TEXT_TECHNIQUES: TextTechnique[] = [
  {
    id: 'halfblock',
    label: 'Half block',
    note: '2 px/cell · 2 colours · works everywhere',
    kind: 'text',
    create: (cols, rows) => createHalfBlockCanvas(cols, rows),
  },
  {
    id: 'sextant',
    label: 'Sextant',
    note: '6 px/cell · 2 colours · needs Unicode 13 font',
    kind: 'text',
    create: (cols, rows) => createSextantCanvas(cols, rows),
  },
  {
    id: 'braille',
    label: 'Braille',
    note: '8 px/cell · 1 colour · dithered',
    kind: 'text',
    create: (cols, rows) => createBrailleCanvas(cols, rows),
  },
  {
    id: 'truecolor',
    label: 'Truecolor',
    note: '1 px/cell · 16.7M colours',
    kind: 'text',
    create: (cols, rows) => createCellCanvas(cols, rows, 'truecolor'),
  },
  {
    id: 'ansi16',
    label: 'ANSI 16',
    note: '1 px/cell · 16 colours',
    kind: 'text',
    create: (cols, rows) => createCellCanvas(cols, rows, 'ansi16'),
  },
  {
    id: 'ascii',
    label: 'ASCII',
    note: '1 px/cell · no colour',
    kind: 'text',
    create: (cols, rows) => createCellCanvas(cols, rows, 'ascii'),
  },
];

export const RASTER_TECHNIQUES: RasterTechnique[] = [
  {
    id: 'kitty',
    label: 'kitty protocol',
    note: 'true pixels · RGBA · scales to a cell box',
    kind: 'raster',
    supported: (support) => support.kitty,
    // c=/r= hand the terminal a cell box and let it do the scaling.
    scalesToCellBox: true,
    encode: (raster, cols, rows) =>
      encodeKittyImage(raster.rgba, raster.width, raster.height, {
        cols,
        rows,
        id: KITTY_IMAGE_ID,
      }),
  },
  {
    id: 'sixel',
    label: 'sixel',
    note: 'true pixels · 216 colours · sized in device pixels',
    kind: 'raster',
    supported: (support) => support.sixel,
    // Sixel has no notion of cells at all: six pixels per band, laid down one
    // device pixel at a time. What you send is the size you get.
    scalesToCellBox: false,
    encode: (raster) => encodeSixelImage(raster.toRgb(), raster.width, raster.height),
  },
  {
    id: 'iterm2',
    label: 'iTerm2 inline',
    note: 'true pixels · takes a PNG file, not pixels',
    kind: 'raster',
    supported: (support) => support.iterm2,
    // Bare width/height in the payload below are counted in cells.
    scalesToCellBox: true,
    encode: (raster, cols, rows) => {
      const png = encodePng(raster.rgba, raster.width, raster.height);
      const payload = Buffer.from(png).toString('base64');
      return `${ESC}]1337;File=inline=1;size=${png.length};width=${cols};height=${rows}:${payload}${BEL}`;
    },
  },
];

export const ALL_TECHNIQUES: Technique[] = [...RASTER_TECHNIQUES, ...TEXT_TECHNIQUES];

export function findTechnique(id: string): Technique | undefined {
  return ALL_TECHNIQUES.find((technique) => technique.id === id);
}

/**
 * Whether this terminal can be asked to draw with `technique`.
 *
 * Text always can — it resolves to characters, and every terminal draws those.
 * A raster protocol is only offered when the probe said so, unless `force`
 * overrides it: detection has real failure modes, chiefly a multiplexer that
 * swallows the query replies and a bare pty that answers nothing at all.
 * Forcing is a way to try anyway, not a way to make an unsupported protocol
 * work.
 */
export function isTechniqueUsable(
  technique: Technique,
  support: GraphicsSupport,
  force = false,
): boolean {
  return technique.kind === 'text' || force || technique.supported(support);
}

/**
 * The best thing this terminal can actually do.
 *
 * Real pixels where they are on offer, and half-block otherwise — the rung of
 * the ladder that needs no protocol, no font coverage, and no luck.
 */
export function bestTechnique(support: GraphicsSupport, force = false): Technique {
  const raster = ALL_TECHNIQUES.find(
    (technique) => technique.kind === 'raster' && isTechniqueUsable(technique, support, force),
  );
  return raster ?? (findTechnique('halfblock') as Technique);
}

/** Wipe any placement this app left behind, so quitting does not strand an image. */
export function clearRasterArtifacts(): string {
  return `${ESC}_Ga=d,d=i,i=${KITTY_IMAGE_ID}${ESC}\\`;
}

export default ALL_TECHNIQUES;

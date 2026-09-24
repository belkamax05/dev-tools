import decodePng, { type DecodedImage } from './decodePng.ts';
import drawImage from './drawImage.ts';
import flattenImage from './flattenImage.ts';
import type { PixelSurface } from './pixelCanvas.ts';
import renderGlobeScene from './scenes/renderGlobeScene.ts';
import renderSphereScene from './scenes/renderSphereScene.ts';

/**
 * What there is to draw.
 *
 * A subject knows nothing about the app drawing it — it is handed a surface
 * and a time, and that is the whole contract that lets the same picture come
 * out of ASCII, braille, or a kitty bitmap. The procedural ones live here; an
 * app's own images (dygma's Sailor Moon, agenti's IDE logos) are loaded with
 * `loadImageSubject` from files the app keeps itself.
 */

/**
 * Something that can be drawn into any surface at any resolution.
 *
 * `animated` is not cosmetic: a static subject lets the app stop its clock
 * entirely, which matters a great deal in raster mode where every repaint
 * re-transmits the whole bitmap down the pty.
 */
export interface Subject {
  id: string;
  label: string;
  note: string;
  animated: boolean;
  /** True for line art, which needs dithering off to stay solid. */
  lineArt?: boolean;
  /**
   * Physical width/height to preserve, if the subject has a fixed shape. An
   * image does; a procedural scene fills whatever it is given.
   */
  aspect?: number;
  draw: (surface: PixelSurface, time: number) => void;
}

export interface ImageSubjectOptions {
  id?: string;
  label?: string;
}

/**
 * A PNG as a static subject, flattened onto `background`.
 *
 * The flattened copy is what the text techniques draw; `source` keeps the
 * alpha channel for a raster protocol that can show it as-is.
 */
export async function loadImageSubject(
  path: string,
  background: readonly [number, number, number],
  { id = path, label = path.split('/').pop() ?? path }: ImageSubjectOptions = {},
): Promise<{ subject: Subject; source: DecodedImage }> {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  const source = decodePng(bytes);
  // A terminal has no alpha channel, so transparency is resolved once here
  // rather than at every repaint.
  const flattened = flattenImage(source, background);

  return {
    source,
    subject: {
      id,
      label,
      note: `${source.width}x${source.height} PNG · static`,
      animated: false,
      aspect: source.width / source.height,
      draw: (surface) => drawImage(surface, flattened),
    },
  };
}

export const BALL_SUBJECT: Subject = {
  id: 'ball',
  label: 'Ball',
  note: 'shaded sphere · checker + specular · animated',
  animated: true,
  draw: (surface, time) => renderSphereScene(surface, { time }),
};

export const GLOBE_SUBJECT: Subject = {
  id: 'globe',
  label: 'Wireframe globe',
  note: 'line art · orbit + starfield · animated',
  animated: true,
  lineArt: true,
  draw: (surface, time) => renderGlobeScene(surface, { time }),
};

export default BALL_SUBJECT;

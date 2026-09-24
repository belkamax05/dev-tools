import type { DecodedImage } from './decodePng.ts';

/**
 * Composite straight-alpha RGBA over an opaque background.
 *
 * Terminals have no alpha channel — a cell is one solid colour — so anything
 * with transparency has to be flattened before it can be drawn. Skipping this
 * step is how a transparent-background PNG ends up rendering as a solid block
 * of whatever happened to be stored under the invisible pixels.
 */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

export function flattenImage(
  source: DecodedImage,
  background: readonly [number, number, number],
): DecodedImage {
  const [br, bg, bb] = background;
  const rgba = new Uint8Array(source.width * source.height * 4);

  for (let i = 0; i < rgba.length; i += 4) {
    const a = at(source.rgba, i + 3) / 255;
    rgba[i] = Math.round(at(source.rgba, i) * a + br * (1 - a));
    rgba[i + 1] = Math.round(at(source.rgba, i + 1) * a + bg * (1 - a));
    rgba[i + 2] = Math.round(at(source.rgba, i + 2) * a + bb * (1 - a));
    rgba[i + 3] = 255;
  }

  return { width: source.width, height: source.height, rgba };
}

export default flattenImage;

import type { DecodedImage } from './decodePng.ts';

/**
 * Box-filter resample.
 *
 * Nearest-neighbour is the obvious choice and the wrong one: shrinking a 537px
 * image into ~60 columns throws away 90% of the pixels, and picking one at
 * random from each cell turns smooth line art into aliased noise. Averaging the
 * whole source rectangle keeps the detail as tone.
 *
 * Accumulation is alpha-premultiplied. Fully transparent pixels routinely carry
 * meaningless RGB — moon.png stores white under its transparent background —
 * and averaging that in unweighted would bleed light halos along every edge.
 */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

export function resampleImage(source: DecodedImage, width: number, height: number): DecodedImage {
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sy0 = Math.floor((y * source.height) / height);
    const sy1 = Math.max(sy0 + 1, Math.ceil(((y + 1) * source.height) / height));

    for (let x = 0; x < width; x++) {
      const sx0 = Math.floor((x * source.width) / width);
      const sx1 = Math.max(sx0 + 1, Math.ceil(((x + 1) * source.width) / width));

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let count = 0;

      for (let sy = sy0; sy < sy1 && sy < source.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < source.width; sx++) {
          const i = (sy * source.width + sx) * 4;
          const a = at(source.rgba, i + 3);
          sumR += at(source.rgba, i) * a;
          sumG += at(source.rgba, i + 1) * a;
          sumB += at(source.rgba, i + 2) * a;
          sumA += a;
          count++;
        }
      }

      const d = (y * width + x) * 4;
      if (sumA === 0 || count === 0) {
        rgba[d] = 0;
        rgba[d + 1] = 0;
        rgba[d + 2] = 0;
        rgba[d + 3] = 0;
        continue;
      }
      // Un-premultiply back to straight alpha.
      rgba[d] = Math.round(sumR / sumA);
      rgba[d + 1] = Math.round(sumG / sumA);
      rgba[d + 2] = Math.round(sumB / sumA);
      rgba[d + 3] = Math.round(sumA / count);
    }
  }

  return { width, height, rgba };
}

export default resampleImage;

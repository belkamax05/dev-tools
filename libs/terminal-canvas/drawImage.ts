import type { DecodedImage } from './decodePng.ts';
import type { PixelSurface } from './pixelCanvas.ts';
import resampleImage from './resampleImage.ts';

/**
 * Blit an image into a surface, resampling to fit if the sizes differ.
 *
 * The surface's own pixel grid is the target resolution, so the same call fills
 * a half-block canvas at 2 px/cell and a braille canvas at 8 px/cell without
 * the caller doing any arithmetic.
 */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

export function drawImage(surface: PixelSurface, image: DecodedImage): void {
  const scaled =
    image.width === surface.width && image.height === surface.height
      ? image
      : resampleImage(image, surface.width, surface.height);

  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const i = (y * scaled.width + x) * 4;
      surface.set(x, y, at(scaled.rgba, i), at(scaled.rgba, i + 1), at(scaled.rgba, i + 2));
    }
  }
}

export default drawImage;

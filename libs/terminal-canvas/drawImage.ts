import { isRasterCanvas } from './createRasterCanvas.ts';
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

  //? A raster surface keeps the image's alpha, so a logo stays transparent
  //? under kitty; every text surface gets the colour alone, which is why an
  //? image has to be flattened before it is drawn into one
  const raster = isRasterCanvas(surface) ? surface : undefined;
  for (let y = 0; y < surface.height; y++) {
    for (let x = 0; x < surface.width; x++) {
      const i = (y * scaled.width + x) * 4;
      const r = at(scaled.rgba, i);
      const g = at(scaled.rgba, i + 1);
      const b = at(scaled.rgba, i + 2);
      if (raster) raster.setPixel(x, y, r, g, b, at(scaled.rgba, i + 3));
      else surface.set(x, y, r, g, b);
    }
  }
}

export default drawImage;

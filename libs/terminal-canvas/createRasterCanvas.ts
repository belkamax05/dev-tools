import type { PixelSurface } from './pixelCanvas.ts';

/**
 * A plain pixel buffer for the graphics-protocol path, where the terminal takes
 * bytes rather than glyphs. Same `set()` as every other surface, so the scene
 * code does not care which one it is drawing into.
 *
 * Stored as RGBA because that is what kitty wants (`f=32`) and what PNG wants;
 * `toRgb()` strips the alpha for sixel.
 */
export interface RasterCanvas extends PixelSurface {
  readonly rgba: Uint8Array;
  toRgb(): Uint8Array;
}

export function createRasterCanvas(width: number, height: number): RasterCanvas {
  const rgba = new Uint8Array(width * height * 4);
  // Opaque by default; nothing here draws transparency.
  rgba.fill(255);

  return {
    width,
    height,
    rgba,
    // Real pixels are square, so no correction is needed.
    pixelAspect: 1,

    clear(r = 0, g = 0, b = 0) {
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
    },

    set(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    },

    toRgb() {
      const rgb = new Uint8Array(width * height * 3);
      for (let p = 0, s = 0, d = 0; p < width * height; p++, s += 4, d += 3) {
        rgb[d] = rgba[s] as number;
        rgb[d + 1] = rgba[s + 1] as number;
        rgb[d + 2] = rgba[s + 2] as number;
      }
      return rgb;
    },
  };
}

export default createRasterCanvas;

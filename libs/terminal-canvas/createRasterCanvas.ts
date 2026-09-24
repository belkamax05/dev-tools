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
  /**
   * `set` with an alpha channel. Only the raster path can show transparency —
   * kitty and iTerm2 composite it over the terminal's own background — so only
   * this surface has it, and `drawImage` uses it when it is there.
   */
  setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void;
  /** `clear`, with the alpha to clear to: 0 for a transparent canvas. */
  clear(r?: number, g?: number, b?: number, a?: number): void;
}

/** Whether a surface can hold transparency — see `RasterCanvas.setPixel`. */
export const isRasterCanvas = (surface: PixelSurface): surface is RasterCanvas =>
  'setPixel' in surface;

export function createRasterCanvas(width: number, height: number): RasterCanvas {
  const rgba = new Uint8Array(width * height * 4);
  // Opaque by default; `setPixel` and `clear(…, 0)` are how transparency gets in.
  rgba.fill(255);

  return {
    width,
    height,
    rgba,
    // Real pixels are square, so no correction is needed.
    pixelAspect: 1,

    clear(r = 0, g = 0, b = 0, a = 255) {
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = a;
      }
    },

    setPixel(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
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

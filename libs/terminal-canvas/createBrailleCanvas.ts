import type { PixelCanvas } from './pixelCanvas.ts';

/**
 * Rung 4: 2x4 = eight addressable dots per cell, the densest grid the text
 * layer offers — but only one colour per cell, because all eight dots are a
 * single glyph drawn in a single foreground colour.
 *
 * Braille patterns live at U+2800 + an 8-bit mask. The historical dot
 * numbering means the bits are not in raster order:
 *
 *     dot1 0x01   dot4 0x08
 *     dot2 0x02   dot5 0x10
 *     dot3 0x04   dot6 0x20
 *     dot7 0x40   dot8 0x80
 *
 * With one bit per dot, a shaded scene has to be dithered. A 4x4 Bayer matrix
 * costs nothing and turns flat thresholding into something that reads as
 * continuous tone.
 */

/** Indexed as `dy * 2 + dx`. */
const DOT_BITS = new Uint8Array([0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80]);

const BAYER_4X4 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

/** See the note in createHalfBlockCanvas: offsets are always in range here. */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

export interface BrailleCanvasOptions {
  /** Ordered dithering instead of a hard luminance cutoff. Default true. */
  dither?: boolean;
  /** Luminance cutoff in 0..1 when dithering is off. Default 0.5. */
  threshold?: number;
}

export function createBrailleCanvas(
  cols: number,
  rows: number,
  options: BrailleCanvasOptions = {},
): PixelCanvas {
  const { dither = true, threshold = 0.5 } = options;
  const width = cols * 2;
  const height = rows * 4;
  const fb = new Uint8Array(width * height * 3);

  return {
    width,
    height,
    cols,
    rows,
    pixelAspect: 1,

    clear(r = 0, g = 0, b = 0) {
      for (let i = 0; i < fb.length; i += 3) {
        fb[i] = r;
        fb[i + 1] = g;
        fb[i + 2] = b;
      }
    },

    set(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 3;
      fb[i] = r;
      fb[i + 1] = g;
      fb[i + 2] = b;
    },

    render() {
      const lines: string[] = [];
      for (let cy = 0; cy < rows; cy++) {
        let line = '';
        let lastFg = -1;
        for (let cx = 0; cx < cols; cx++) {
          let mask = 0;
          // The cell's single colour is the mean of whichever dots survived
          // the threshold, so a lit cell takes the hue of what lit it.
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let lit = 0;
          for (let dy = 0; dy < 4; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const px = cx * 2 + dx;
              const py = cy * 4 + dy;
              const i = (py * width + px) * 3;
              const r = at(fb, i);
              const g = at(fb, i + 1);
              const b = at(fb, i + 2);
              const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
              const cut = dither ? (at(BAYER_4X4, (py & 3) * 4 + (px & 3)) + 0.5) / 16 : threshold;
              if (lum > cut) {
                mask |= at(DOT_BITS, dy * 2 + dx);
                sr += r;
                sg += g;
                sb += b;
                lit++;
              }
            }
          }
          if (lit === 0) {
            // U+2800 is a blank braille cell, not a space: it keeps the
            // column grid intact in fonts where space is a different width.
            line += '⠀';
            continue;
          }
          const r = Math.round(sr / lit);
          const g = Math.round(sg / lit);
          const b = Math.round(sb / lit);
          const key = (r << 16) | (g << 8) | b;
          if (key !== lastFg) {
            line += `\x1b[38;2;${r};${g};${b}m`;
            lastFg = key;
          }
          line += String.fromCodePoint(0x2800 + mask);
        }
        lines.push(`${line}\x1b[0m`);
      }
      return lines.join('\n');
    },
  };
}

export default createBrailleCanvas;

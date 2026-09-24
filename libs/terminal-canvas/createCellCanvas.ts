import type { PixelCanvas } from './pixelCanvas.ts';

/**
 * Rungs 1-3: one pixel per whole cell, in three flavours, so the ladder demo
 * has a floor to compare against.
 *
 *   ascii     — luminance ramp, no colour at all. What "ASCII is the max" means.
 *   ansi16    — full block in the nearest of the 16 legacy colours.
 *   truecolor — full block in exact 24-bit colour.
 *
 * The jump from ansi16 to truecolor is free on any terminal built this decade,
 * and it is the biggest visual win per line of code changed.
 */
export type CellCanvasMode = 'ascii' | 'ansi16' | 'truecolor';

const ASCII_RAMP = ' .:-=+*#%@';

/** Approximate sRGB values of the 16 legacy ANSI colours, flattened to RGB triples. */
const ANSI16 = new Uint8Array([
  0, 0, 0, 170, 0, 0, 0, 170, 0, 170, 85, 0, 0, 0, 170, 170, 0, 170, 0, 170, 170, 170, 170, 170, 85,
  85, 85, 255, 85, 85, 85, 255, 85, 255, 255, 85, 85, 85, 255, 255, 85, 255, 85, 255, 255, 255, 255,
  255,
]);

/** See the note in createHalfBlockCanvas: offsets are always in range here. */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

function nearestAnsi16(r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 16; i++) {
    const dr = r - at(ANSI16, i * 3);
    const dg = g - at(ANSI16, i * 3 + 1);
    const db = b - at(ANSI16, i * 3 + 2);
    // Weighted euclidean distance: closer to perceptual than a flat metric and
    // far cheaper than converting to Lab for every pixel of every frame.
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

export function createCellCanvas(
  cols: number,
  rows: number,
  mode: CellCanvasMode = 'truecolor',
): PixelCanvas {
  const fb = new Uint8Array(cols * rows * 3);

  return {
    width: cols,
    height: rows,
    cols,
    rows,
    // One pixel is one whole cell: half as wide as it is tall.
    pixelAspect: 0.5,

    clear(r = 0, g = 0, b = 0) {
      for (let i = 0; i < fb.length; i += 3) {
        fb[i] = r;
        fb[i + 1] = g;
        fb[i + 2] = b;
      }
    },

    set(x, y, r, g, b) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = (y * cols + x) * 3;
      fb[i] = r;
      fb[i + 1] = g;
      fb[i + 2] = b;
    },

    render() {
      const lines: string[] = [];
      for (let y = 0; y < rows; y++) {
        let line = '';
        let last = -1;
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 3;
          const r = at(fb, i);
          const g = at(fb, i + 1);
          const b = at(fb, i + 2);

          if (mode === 'ascii') {
            const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            const index = Math.min(ASCII_RAMP.length - 1, Math.floor(lum * ASCII_RAMP.length));
            line += ASCII_RAMP[index];
            continue;
          }

          if (mode === 'ansi16') {
            const index = nearestAnsi16(r, g, b);
            if (index !== last) {
              line += `\x1b[38;5;${index}m`;
              last = index;
            }
            line += '█';
            continue;
          }

          const key = (r << 16) | (g << 8) | b;
          if (key !== last) {
            line += `\x1b[38;2;${r};${g};${b}m`;
            last = key;
          }
          line += '█';
        }
        lines.push(mode === 'ascii' ? line : `${line}\x1b[0m`);
      }
      return lines.join('\n');
    },
  };
}

export default createCellCanvas;

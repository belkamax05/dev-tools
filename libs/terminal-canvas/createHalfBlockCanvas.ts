import type { PixelCanvas } from './pixelCanvas.ts';

/**
 * Rung 3 of the ladder: two independently coloured pixels per cell.
 *
 * `▀` (U+2580) paints the top half of the cell in the foreground colour and
 * leaves the bottom half showing the background colour, so one cell carries two
 * 24-bit pixels. Because a cell is roughly twice as tall as it is wide, the
 * resulting pixels are square.
 *
 * Universally supported — this is the highest-fidelity technique that needs
 * nothing from the terminal beyond truecolor and one Unicode block glyph.
 */

/**
 * Every offset below is derived from the framebuffer's own dimensions, so it is
 * always in range. `noUncheckedIndexedAccess` cannot see that, and a bare
 * `buffer[i]` would be typed `number | undefined`.
 */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

export function createHalfBlockCanvas(cols: number, rows: number): PixelCanvas {
  const width = cols;
  const height = rows * 2;
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
        // Re-emitting an SGR pair per cell triples the byte count for no
        // visual gain, so only emit on change.
        let lastFg = -1;
        let lastBg = -1;
        const topRow = cy * 2 * width * 3;
        const botRow = (cy * 2 + 1) * width * 3;
        for (let x = 0; x < width; x++) {
          const t = topRow + x * 3;
          const b = botRow + x * 3;
          const tr = at(fb, t);
          const tg = at(fb, t + 1);
          const tb = at(fb, t + 2);
          const br = at(fb, b);
          const bg = at(fb, b + 1);
          const bb = at(fb, b + 2);
          const fgKey = (tr << 16) | (tg << 8) | tb;
          const bgKey = (br << 16) | (bg << 8) | bb;
          if (fgKey !== lastFg) {
            line += `\x1b[38;2;${tr};${tg};${tb}m`;
            lastFg = fgKey;
          }
          if (bgKey !== lastBg) {
            line += `\x1b[48;2;${br};${bg};${bb}m`;
            lastBg = bgKey;
          }
          line += '▀';
        }
        lines.push(`${line}\x1b[0m`);
      }
      return lines.join('\n');
    },
  };
}

export default createHalfBlockCanvas;

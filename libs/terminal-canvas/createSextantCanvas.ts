import type { PixelCanvas } from './pixelCanvas.ts';

/**
 * Rung 5: 2x3 = six pixels per cell with *two* colours, splitting the
 * difference between half-blocks (2 px, 2 colours) and braille (8 px, 1 colour).
 *
 * Sextants arrived in Unicode 13's Symbols for Legacy Computing block. The
 * layout is raster order, unlike braille:
 *
 *     1 2     0x01 0x02
 *     3 4     0x04 0x08
 *     5 6     0x10 0x20
 *
 * The encoding has two potholes. U+1FB00 holds pattern 1, and the block *skips*
 * patterns 21 and 42 because those already exist as the left and right half
 * blocks — so every value above them shifts down by one. Patterns 0 and 63 are
 * space and full block.
 *
 * Caveat worth knowing before shipping this: font coverage is thinner than
 * braille's. It renders beautifully in Ghostty/kitty/foot with a modern font
 * and shows tofu in plenty of others.
 */
type NumericBuffer = Uint8Array | Int32Array | Float32Array;

/** See the note in createHalfBlockCanvas: offsets are always in range here. */
const at = (buffer: NumericBuffer, index: number): number => buffer[index] as number;

function sextantGlyph(mask: number): string {
  if (mask === 0) return ' ';
  if (mask === 63) return '█';
  if (mask === 21) return '▌';
  if (mask === 42) return '▐';
  let index = mask - 1;
  if (mask > 21) index--;
  if (mask > 42) index--;
  return String.fromCodePoint(0x1fb00 + index);
}

export function createSextantCanvas(cols: number, rows: number): PixelCanvas {
  const width = cols * 2;
  const height = rows * 3;
  const fb = new Uint8Array(width * height * 3);

  return {
    width,
    height,
    cols,
    rows,
    // 2 across and 3 down inside a 1x2 cell gives a pixel 0.5 wide by 0.667
    // tall — slightly taller than square.
    pixelAspect: 0.75,

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
      const lum = new Float32Array(6);
      const offsets = new Int32Array(6);
      for (let cy = 0; cy < rows; cy++) {
        let line = '';
        let lastFg = -1;
        let lastBg = -1;
        for (let cx = 0; cx < cols; cx++) {
          let mean = 0;
          for (let dy = 0; dy < 3; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const n = dy * 2 + dx;
              const i = ((cy * 3 + dy) * width + (cx * 2 + dx)) * 3;
              offsets[n] = i;
              const l = 0.2126 * at(fb, i) + 0.7152 * at(fb, i + 1) + 0.0722 * at(fb, i + 2);
              lum[n] = l;
              mean += l;
            }
          }
          mean /= 6;

          // Two-colour quantisation: everything brighter than the cell mean
          // becomes the foreground, the rest the background, and each colour
          // is the mean of its own group.
          let mask = 0;
          let fr = 0;
          let fgSum = 0;
          let fbSum = 0;
          let fCount = 0;
          let br = 0;
          let bgSum = 0;
          let bbSum = 0;
          let bCount = 0;
          for (let n = 0; n < 6; n++) {
            const i = at(offsets, n);
            if (at(lum, n) > mean) {
              mask |= 1 << n;
              fr += at(fb, i);
              fgSum += at(fb, i + 1);
              fbSum += at(fb, i + 2);
              fCount++;
            } else {
              br += at(fb, i);
              bgSum += at(fb, i + 1);
              bbSum += at(fb, i + 2);
              bCount++;
            }
          }
          // A flat cell has no bright group; paint it entirely as background.
          const fgR = fCount ? Math.round(fr / fCount) : 0;
          const fgG = fCount ? Math.round(fgSum / fCount) : 0;
          const fgB = fCount ? Math.round(fbSum / fCount) : 0;
          const bgR = bCount ? Math.round(br / bCount) : fgR;
          const bgG = bCount ? Math.round(bgSum / bCount) : fgG;
          const bgB = bCount ? Math.round(bbSum / bCount) : fgB;

          const fgKey = (fgR << 16) | (fgG << 8) | fgB;
          const bgKey = (bgR << 16) | (bgG << 8) | bgB;
          if (fCount && fgKey !== lastFg) {
            line += `\x1b[38;2;${fgR};${fgG};${fgB}m`;
            lastFg = fgKey;
          }
          if (bgKey !== lastBg) {
            line += `\x1b[48;2;${bgR};${bgG};${bgB}m`;
            lastBg = bgKey;
          }
          line += sextantGlyph(mask);
        }
        lines.push(`${line}\x1b[0m`);
      }
      return lines.join('\n');
    },
  };
}

export default createSextantCanvas;

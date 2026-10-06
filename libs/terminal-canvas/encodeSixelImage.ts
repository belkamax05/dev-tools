/**
 * Sixel — the 1987 DEC raster format, still the widest-reaching way to put real
 * pixels in a terminal (xterm, foot, WezTerm, Konsole, mlterm, VS Code).
 *
 * The format thinks in horizontal *bands* six pixels tall. One character
 * encodes a column of six pixels as a bitmask offset by 63, so `?` is six empty
 * pixels and `~` is six set ones. Only one colour can be active at a time, so a
 * band is drawn once per colour: `$` returns to the start of the band without
 * advancing, and `-` moves down to the next band.
 *
 * Colour is indexed, not direct, so the image is quantised to a 6x6x6 cube
 * (216 colours) — visibly coarser than truecolor half-blocks on smooth
 * gradients, but with 6x the spatial resolution.
 *
 * Unlike the kitty and iTerm2 protocols, sixel has no notion of cells: the
 * image lands at one device pixel per sixel pixel. Sizing it to a known number
 * of rows therefore depends on knowing the real cell size — see
 * detectGraphicsSupport.ts.
 */
const CUBE_STEPS = 6;

/** See the note in createHalfBlockCanvas: offsets are always in range here. */
const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

/** Sixel colour components are percentages, not 0-255. */
function toPercent(step: number): number {
  return Math.round((step / (CUBE_STEPS - 1)) * 100);
}

export function encodeSixelImage(rgb: Uint8Array, width: number, height: number): string {
  const quantised = new Uint8Array(width * height);
  const used = new Set<number>();
  for (let i = 0, p = 0; p < quantised.length; p++, i += 3) {
    const r = Math.round((at(rgb, i) / 255) * (CUBE_STEPS - 1));
    const g = Math.round((at(rgb, i + 1) / 255) * (CUBE_STEPS - 1));
    const b = Math.round((at(rgb, i + 2) / 255) * (CUBE_STEPS - 1));
    const index = r * 36 + g * 6 + b;
    quantised[p] = index;
    used.add(index);
  }

  // DCS parameters P1;P2;P3, then the raster attributes Pan;Pad;Ph;Pv.
  //
  // P2=1 is load-bearing rather than a detail. It means "a 0 bit leaves the
  // pixel alone". Under the default P2=0 a 0 bit paints the *background*
  // colour, and since only one colour is active at a time, each colour pass
  // over a band would erase every pass before it — the image arrives blank
  // except for whichever colour happened to be written last.
  let out = `\x1bP0;1;0q"1;1;${width};${height}`;
  for (const index of used) {
    const r = toPercent(Math.floor(index / 36));
    const g = toPercent(Math.floor(index / 6) % 6);
    const b = toPercent(index % 6);
    out += `#${index};2;${r};${g};${b}`;
  }

  for (let bandTop = 0; bandTop < height; bandTop += 6) {
    const bandHeight = Math.min(6, height - bandTop);

    const inBand = new Set<number>();
    for (let dy = 0; dy < bandHeight; dy++) {
      const row = (bandTop + dy) * width;
      for (let x = 0; x < width; x++) inBand.add(at(quantised, row + x));
    }

    const passes: string[] = [];
    for (const colour of inBand) {
      let pass = `#${colour}`;

      const emit = (mask: number, length: number, isFinal: boolean) => {
        if (length === 0) return;
        // A trailing run of empty sixels is implicit, and dropping it is the
        // biggest size win on images with dark margins. Interior empty runs
        // still have to be written, or the pixels after them shift left.
        if (mask === 0 && isFinal) return;
        const ch = String.fromCharCode(63 + mask);
        pass += length > 3 ? `!${length}${ch}` : ch.repeat(length);
      };

      let runMask = -1;
      let runLength = 0;
      for (let x = 0; x < width; x++) {
        let mask = 0;
        for (let dy = 0; dy < bandHeight; dy++) {
          if (at(quantised, (bandTop + dy) * width + x) === colour) mask |= 1 << dy;
        }
        if (mask === runMask) {
          runLength++;
        } else {
          emit(runMask, runLength, false);
          runMask = mask;
          runLength = 1;
        }
      }
      emit(runMask, runLength, true);
      passes.push(pass);
    }

    out += `${passes.join('$')}-`;
  }

  return `${out}\x1b\\`;
}

export default encodeSixelImage;

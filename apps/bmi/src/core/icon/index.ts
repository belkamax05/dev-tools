import decodePng, { type DecodedImage } from '@/dev-tools/terminal-canvas/decodePng';
import resampleImage from '@/dev-tools/terminal-canvas/resampleImage';

export type { DecodedImage };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

const isPng = (bytes: Uint8Array, offset = 0) =>
  PNG_SIGNATURE.every((byte, index) => bytes[offset + index] === byte);

const at = (bytes: Uint8Array, index: number) => bytes[index] ?? 0;

/**
 * A BMP image as an ICO entry stores it: a `BITMAPINFOHEADER`, a palette when it has 8 bits a
 * pixel or fewer, the colour rows bottom-up, then a 1-bit transparency mask the same way round.
 * The header's height counts both, so it is twice the image's.
 */
const decodeIcoBitmap = (bytes: Uint8Array): DecodedImage => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  const height = Math.abs(view.getInt32(8, true)) / 2;
  const bpp = view.getUint16(14, true);
  const compression = view.getUint32(16, true);
  if (compression !== 0 && compression !== 3) throw new Error('compressed ICO bitmap');
  if (![1, 4, 8, 24, 32].includes(bpp)) throw new Error(`${bpp}-bit ICO bitmap`);
  if (width <= 0 || height <= 0 || width > 512 || height > 512) throw new Error('bad ICO size');

  const colorsUsed = view.getUint32(32, true);
  const paletteSize = bpp <= 8 ? colorsUsed || 1 << bpp : 0;
  const paletteAt = headerSize;
  const pixelsAt = paletteAt + paletteSize * 4;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskAt = pixelsAt + stride * height;
  const maskStride = Math.ceil(width / 32) * 4;

  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = pixelsAt + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let b: number;
      let g: number;
      let r: number;
      let a = 255;
      if (bpp === 32 || bpp === 24) {
        const i = row + x * (bpp / 8);
        b = at(bytes, i);
        g = at(bytes, i + 1);
        r = at(bytes, i + 2);
        if (bpp === 32) {
          a = at(bytes, i + 3);
          if (a) anyAlpha = true;
        }
      } else {
        const bit = x * bpp;
        const byte = at(bytes, row + (bit >> 3));
        const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        const p = paletteAt + index * 4;
        b = at(bytes, p);
        g = at(bytes, p + 1);
        r = at(bytes, p + 2);
      }
      rgba[out] = r;
      rgba[out + 1] = g;
      rgba[out + 2] = b;
      rgba[out + 3] = a;
    }
  }

  //? The AND mask is the transparency of everything but a 32-bit image with a real alpha
  //? channel — and of one whose alpha is all zero, which is how old tools wrote 32-bit icons
  if (bpp !== 32 || !anyAlpha) {
    for (let y = 0; y < height; y++) {
      const row = maskAt + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const transparent = (at(bytes, row + (x >> 3)) >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
};

/**
 * The best image in an `.ico`: the smallest at least 32px across (plenty for a few terminal
 * cells, and cheapest to resample), else the largest there is. Entries that fail to decode are
 * skipped rather than failing the icon.
 */
const decodeIco = (bytes: Uint8Array): DecodedImage => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries = Array.from({ length: count }, (_, index) => {
    const base = 6 + index * 16;
    return {
      size: at(bytes, base) || 256,
      length: view.getUint32(base + 8, true),
      offset: view.getUint32(base + 12, true),
    };
  }).filter((entry) => entry.offset + entry.length <= bytes.length);

  const ranked = [
    ...entries.filter((entry) => entry.size >= 32).sort((a, b) => a.size - b.size),
    ...entries.filter((entry) => entry.size < 32).sort((a, b) => b.size - a.size),
  ];
  for (const entry of ranked) {
    const data = bytes.subarray(entry.offset, entry.offset + entry.length);
    try {
      return isPng(data) ? decodePng(data) : decodeIcoBitmap(data);
    } catch {}
  }
  throw new Error('no usable image in the .ico');
};

/**
 * A favicon's pixels, from a PNG or an ICO — told apart by their bytes, not by the URL, since
 * plenty of `favicon.ico`s are PNGs. SVG, GIF and JPEG are refused: there is no decoder for them
 * here, and a site offering one almost always offers a PNG or ICO as well.
 */
export const decodeIcon = (bytes: Uint8Array): DecodedImage => {
  if (isPng(bytes)) return decodePng(bytes);
  if (at(bytes, 0) === 0 && at(bytes, 1) === 0 && at(bytes, 2) === 1 && at(bytes, 3) === 0) {
    return decodeIco(bytes);
  }
  throw new Error('not a PNG or ICO image');
};

/** Shrink to fit `max` pixels a side, keeping the shape — what is worth keeping in the cache. */
export const fitIcon = (image: DecodedImage, max = 64): DecodedImage => {
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  if (scale === 1) return image;
  return resampleImage(
    image,
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
};

/**
 * An icon as `rows` lines of half blocks, `cols` cells wide — two square pixels a cell.
 *
 * Unlike the canvases in terminal-canvas this keeps transparency: a pixel under half alpha is not
 * drawn at all, so the icon sits on whatever the terminal's background is instead of on a square
 * of a guessed colour. A cell with only its lower half visible is drawn with `▄`.
 */
export const renderIcon = (image: DecodedImage, cols: number, rows: number): string[] => {
  const scaled = resampleImage(image, cols, rows * 2);
  const pixel = (x: number, y: number) => {
    const i = (y * cols + x) * 4;
    return at(scaled.rgba, i + 3) < 128
      ? undefined
      : `${at(scaled.rgba, i)};${at(scaled.rgba, i + 1)};${at(scaled.rgba, i + 2)}`;
  };
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const top = pixel(x, row * 2);
      const bottom = pixel(x, row * 2 + 1);
      if (top && bottom) line += `\x1b[38;2;${top}m\x1b[48;2;${bottom}m▀\x1b[0m`;
      else if (top) line += `\x1b[38;2;${top}m▀\x1b[0m`;
      else if (bottom) line += `\x1b[38;2;${bottom}m▄\x1b[0m`;
      else line += ' ';
    }
    lines.push(line);
  }
  return lines;
};

export default decodeIcon;

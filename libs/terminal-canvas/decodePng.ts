/**
 * PNG decoder, the counterpart to encodePng.ts.
 *
 * Supports every non-interlaced PNG: bit depths 1/2/4/8/16, all five colour
 * types, palettes, and `tRNS` transparency. Adam7 interlacing is rejected with
 * a clear message rather than decoded wrong — it is rare enough in practice
 * that the deinterlacing pass is not worth carrying here.
 *
 * `Bun.inflateSync` is raw INFLATE, symmetric with `Bun.deflateSync`, so the
 * zlib container PNG wraps IDAT in has to be stripped by hand: two header bytes
 * at the front, four Adler-32 bytes at the back.
 */
export interface DecodedImage {
  width: number;
  height: number;
  /** Straight (not premultiplied) RGBA, 8 bits per channel. */
  rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const at = (buffer: Uint8Array, index: number): number => buffer[index] as number;

/** Samples per pixel for each PNG colour type; index is the colour type. */
const SAMPLES: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Undo the per-scanline filters in place, leaving raw samples. */
function unfilter(
  data: Uint8Array,
  height: number,
  stride: number,
  bytesPerPixel: number,
): Uint8Array {
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = at(data, y * (stride + 1));
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let i = 0; i < stride; i++) {
      const raw = at(data, src + i);
      const a = i >= bytesPerPixel ? at(out, dst + i - bytesPerPixel) : 0;
      const b = y > 0 ? at(out, up + i) : 0;
      const c = y > 0 && i >= bytesPerPixel ? at(out, up + i - bytesPerPixel) : 0;

      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + a;
          break;
        case 2:
          value = raw + b;
          break;
        case 3:
          value = raw + ((a + b) >> 1);
          break;
        case 4:
          value = raw + paeth(a, b, c);
          break;
        default:
          throw new Error(`Unknown PNG filter type ${filter} on row ${y}`);
      }
      out[dst + i] = value & 0xff;
    }
  }
  return out;
}

/**
 * Expand one scanline to one byte per sample. Bit depths below 8 pack several
 * samples per byte; depth 16 is truncated to its high byte, which is all a
 * terminal can show anyway.
 */
function readSamples(
  row: Uint8Array,
  offset: number,
  count: number,
  bitDepth: number,
  scaleToByte: boolean,
): Uint8Array {
  const out = new Uint8Array(count);
  if (bitDepth === 8) {
    for (let i = 0; i < count; i++) out[i] = at(row, offset + i);
    return out;
  }
  if (bitDepth === 16) {
    for (let i = 0; i < count; i++) out[i] = at(row, offset + i * 2);
    return out;
  }
  const max = (1 << bitDepth) - 1;
  const perByte = 8 / bitDepth;
  for (let i = 0; i < count; i++) {
    const byte = at(row, offset + Math.floor(i / perByte));
    const shift = 8 - bitDepth * ((i % perByte) + 1);
    const value = (byte >> shift) & max;
    // Greyscale needs rescaling to 0-255; a palette index must stay as-is.
    out[i] = scaleToByte ? Math.round((value / max) * 255) : value;
  }
  return out;
}

export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) {
    if (at(bytes, i) !== SIGNATURE[i]) throw new Error('Not a PNG (bad signature)');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colourType = 6;
  let palette: Uint8Array | undefined;
  let paletteAlpha: Uint8Array | undefined;
  const idatParts: Uint8Array[] = [];

  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      at(bytes, offset + 4),
      at(bytes, offset + 5),
      at(bytes, offset + 6),
      at(bytes, offset + 7),
    );
    const body = bytes.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = at(bytes, offset + 16);
      colourType = at(bytes, offset + 17);
      if (at(bytes, offset + 20) !== 0) {
        throw new Error('Adam7-interlaced PNGs are not supported by this decoder');
      }
    } else if (type === 'PLTE') {
      palette = body.slice();
    } else if (type === 'tRNS') {
      paletteAlpha = body.slice();
    } else if (type === 'IDAT') {
      idatParts.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const samplesPerPixel = SAMPLES[colourType];
  if (samplesPerPixel === undefined) throw new Error(`Unsupported colour type ${colourType}`);
  if (colourType === 3 && !palette) throw new Error('Indexed PNG with no PLTE chunk');

  // Concatenate IDAT, then strip the zlib container Bun.inflateSync will not accept.
  let total = 0;
  for (const part of idatParts) total += part.length;
  const compressed = new Uint8Array(total);
  let cursor = 0;
  for (const part of idatParts) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const inflated = Bun.inflateSync(compressed.subarray(2, compressed.length - 4));

  const bitsPerPixel = samplesPerPixel * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  if (inflated.length < height * (stride + 1)) {
    throw new Error(`Truncated PNG: got ${inflated.length} bytes, need ${height * (stride + 1)}`);
  }
  const raw = unfilter(inflated, height, stride, bytesPerPixel);

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const samples = readSamples(
      row,
      0,
      width * samplesPerPixel,
      bitDepth,
      colourType !== 3, // palette indices must not be rescaled
    );
    for (let x = 0; x < width; x++) {
      const s = x * samplesPerPixel;
      const d = (y * width + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      let a = 255;

      switch (colourType) {
        case 0:
          r = g = b = at(samples, s);
          break;
        case 2:
          r = at(samples, s);
          g = at(samples, s + 1);
          b = at(samples, s + 2);
          break;
        case 3: {
          const index = at(samples, s);
          const p = palette as Uint8Array;
          r = at(p, index * 3);
          g = at(p, index * 3 + 1);
          b = at(p, index * 3 + 2);
          if (paletteAlpha && index < paletteAlpha.length) a = at(paletteAlpha, index);
          break;
        }
        case 4:
          r = g = b = at(samples, s);
          a = at(samples, s + 1);
          break;
        default:
          r = at(samples, s);
          g = at(samples, s + 1);
          b = at(samples, s + 2);
          a = at(samples, s + 3);
          break;
      }

      rgba[d] = r;
      rgba[d + 1] = g;
      rgba[d + 2] = b;
      rgba[d + 3] = a;
    }
  }

  return { width, height, rgba };
}

export default decodePng;

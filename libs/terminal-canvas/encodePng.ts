/**
 * Minimal PNG encoder — needed because the iTerm2 inline-image protocol takes a
 * *file format*, not raw pixels (unlike kitty, which happily accepts RGBA).
 *
 * Only the three mandatory chunks, colour type 6 (RGBA), 8 bits per channel,
 * and filter 0 on every scanline. No filtering heuristics: this exists to make
 * bytes a terminal will accept, not to compete with libpng on size.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adler-32, the checksum a zlib stream ends with. Reduced every iteration so
 * `b` cannot drift past the range where a double still counts exactly.
 */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + (bytes[i] as number)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Wrap raw DEFLATE in the zlib container (RFC 1950) that PNG's IDAT requires.
 *
 * `Bun.deflateSync` emits *raw* deflate — byte-identical to node's
 * `deflateRawSync`, with no option to change it — so the 2-byte header and
 * trailing Adler-32 have to be added here. A PNG built without them passes a
 * CRC check and fools `file`, which only reads IHDR, then fails in every real
 * decoder.
 */
function toZlibStream(data: Uint8Array<ArrayBuffer>): Uint8Array {
  const deflated = Bun.deflateSync(data);
  const out = new Uint8Array(deflated.length + 6);
  // CMF 0x78 (deflate, 32K window), FLG 0x01: (0x78 << 8 | 0x01) % 31 === 0.
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(deflated, 2);
  new DataView(out.buffer).setUint32(out.length - 4, adler32(data));
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with its filter byte.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', toZlibStream(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export default encodePng;

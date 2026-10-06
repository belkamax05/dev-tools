import { describe, expect, test } from 'bun:test';

import encodePng from '@/dev-tools/terminal-canvas/encodePng';

import { decodeIcon, fitIcon, renderIcon } from '.';

/** A square of one colour, left half opaque and right half transparent. */
const halfImage = (size: number, [r, g, b]: [number, number, number]) => {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      rgba.set([r, g, b, x < size / 2 ? 255 : 0], i);
    }
  }
  return rgba;
};

/** An `.ico` wrapping `images`, the way Windows tools write one. */
const ico = (images: { size: number; data: Uint8Array }[]) => {
  const header = new Uint8Array(6 + images.length * 16);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach((image, index) => {
    const base = 6 + index * 16;
    header[base] = image.size;
    header[base + 1] = image.size;
    view.setUint32(base + 8, image.data.length, true);
    view.setUint32(base + 12, offset, true);
    offset += image.data.length;
  });
  return new Uint8Array(Buffer.concat([header, ...images.map((image) => image.data)]));
};

/** A 32-bit BMP entry: BITMAPINFOHEADER, BGRA rows bottom-up, then an all-opaque AND mask. */
const bmp32 = (size: number, rgba: Uint8Array) => {
  const maskStride = Math.ceil(size / 32) * 4;
  const out = new Uint8Array(40 + size * size * 4 + maskStride * size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, size, true);
  view.setInt32(8, size * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + ((size - 1 - y) * size + x) * 4;
      out.set([rgba[from + 2] ?? 0, rgba[from + 1] ?? 0, rgba[from] ?? 0, rgba[from + 3] ?? 0], to);
    }
  }
  return out;
};

describe('decodeIcon', () => {
  test('reads a PNG', () => {
    const image = decodeIcon(encodePng(halfImage(4, [255, 0, 0]), 4, 4));
    expect([image.width, image.height]).toEqual([4, 4]);
    expect([...image.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  test('reads a 32-bit BMP inside an ICO, the right way up', () => {
    const rgba = halfImage(16, [0, 128, 255]);
    rgba.set([255, 255, 255, 255], 0); //? top-left pixel white, to catch a flipped image
    const image = decodeIcon(ico([{ size: 16, data: bmp32(16, rgba) }]));
    expect([image.width, image.height]).toEqual([16, 16]);
    expect([...image.rgba.slice(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...image.rgba.slice(4, 8)]).toEqual([0, 128, 255, 255]);
    expect(image.rgba[15 * 4 + 3]).toBe(0);
  });

  test('prefers the smallest entry of at least 32px, PNG or not', () => {
    const image = decodeIcon(
      ico([
        { size: 16, data: bmp32(16, halfImage(16, [1, 1, 1])) },
        { size: 64, data: encodePng(halfImage(64, [3, 3, 3]), 64, 64) },
        { size: 32, data: encodePng(halfImage(32, [2, 2, 2]), 32, 32) },
      ]),
    );
    expect(image.width).toBe(32);
  });

  test('refuses what it cannot draw', () => {
    expect(() => decodeIcon(new TextEncoder().encode('<svg/>'))).toThrow();
  });
});

describe('fitIcon', () => {
  test('shrinks to fit, never grows', () => {
    const big = { width: 128, height: 64, rgba: new Uint8Array(128 * 64 * 4) };
    expect([fitIcon(big).width, fitIcon(big).height]).toEqual([64, 32]);
    const small = { width: 16, height: 16, rgba: new Uint8Array(16 * 16 * 4) };
    expect(fitIcon(small)).toBe(small);
  });
});

describe('renderIcon', () => {
  test('draws opaque pixels as half blocks and leaves transparent ones blank', () => {
    const lines = renderIcon({ width: 4, height: 4, rgba: halfImage(4, [10, 20, 30]) }, 4, 2);
    expect(lines).toHaveLength(2);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping colour codes
    const plain = lines.map((line) => line.replace(/\x1b\[[\d;]*m/g, ''));
    expect(plain).toEqual(['▀▀  ', '▀▀  ']);
    expect(lines[0]).toContain('38;2;10;20;30');
  });
});

import { describe, expect, test } from 'bun:test';
import { encode } from 'jpeg-js';

import { encodePng } from '@/dev-tools/terminal-canvas';

import { decodeAvatar } from '.';

/** A 4×4 picture, left half red, right half blue. */
const pixels = () => {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let at = 0; at < 16; at++) {
    const left = at % 4 < 2;
    rgba.set([left ? 255 : 0, 0, left ? 0 : 255, 255], at * 4);
  }
  return rgba;
};

describe('decodeAvatar', () => {
  test('a JPEG comes back as RGBA of the same size, colours roughly kept', () => {
    const jpeg = encode({ data: Buffer.from(pixels()), width: 4, height: 4 }, 100).data;
    const image = decodeAvatar(new Uint8Array(jpeg));
    expect(image).toMatchObject({ width: 4, height: 4 });
    const [r, , b] = image?.rgba ?? [];
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(60);
  });

  test('a PNG still goes through the PNG decoder', () => {
    const png = encodePng(pixels(), 4, 4);
    expect(decodeAvatar(png)).toMatchObject({ width: 4, height: 4 });
  });

  test('anything else is not a picture', () => {
    expect(decodeAvatar(new TextEncoder().encode('<html>'))).toBeUndefined();
  });
});

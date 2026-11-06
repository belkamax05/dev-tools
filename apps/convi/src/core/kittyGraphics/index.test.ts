import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import encodeKittyImage from '@/dev-tools/terminal-canvas/encodeKittyImage';
import encodePng from '@/dev-tools/terminal-canvas/encodePng';
import { ESC } from '@/dev-tools/ui/terminal/ansi';

import { createKittyGraphics } from '.';

//? The APC bodies of a kitty escape stream: `ESC _ <body> ESC \` each
const bodiesOf = (stream: string) =>
  [...stream.matchAll(new RegExp(`${ESC}_([^${ESC}]*)${ESC}\\\\`, 'g'))].map((m) => m[1] as string);

const feed = (stream: string, read = createKittyGraphics()) =>
  bodiesOf(stream)
    .map(read)
    .filter((image) => image !== undefined);

const pngOf = (src: string) => Buffer.from(src.replace('data:image/png;base64,', ''), 'base64');

const red = (pixels: number) =>
  Uint8Array.from({ length: pixels * 4 }, (_, i) => [255, 0, 0, 255][i % 4] as number);

describe('kitty graphics', () => {
  test('RGBA in several chunks becomes one PNG, sized by s and v, placed in c × r cells', () => {
    //? 40×40 RGBA is 6400 bytes - more than one 4096-byte base64 chunk
    const stream = encodeKittyImage(red(1600), 40, 40, { cols: 10, rows: 5 });
    expect(bodiesOf(stream).length).toBeGreaterThan(1);
    const [image, ...rest] = feed(stream);
    expect(rest).toEqual([]);
    expect([image?.width, image?.height, image?.cols, image?.rows]).toEqual([40, 40, 10, 5]);
    expect([...pngOf(image?.src ?? '').subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test('zlib-compressed RGB and a ready PNG are read too', () => {
    const rgb = deflateSync(Uint8Array.from({ length: 2 * 3 * 3 }, () => 7));
    const [fromRgb] = feed(
      `${ESC}_Ga=T,f=24,o=z,s=2,v=3,q=2;${Buffer.from(rgb).toString('base64')}${ESC}\\`,
    );
    expect([fromRgb?.width, fromRgb?.height]).toEqual([2, 3]);

    const png = Buffer.from(encodePng(red(6), 3, 2)).toString('base64');
    const [fromPng] = feed(`${ESC}_Ga=T,f=100;${png}${ESC}\\`);
    expect(fromPng).toEqual({
      src: `data:image/png;base64,${png}`,
      width: 3,
      height: 2,
      cols: undefined,
      rows: undefined,
    });
  });

  test('transmit with an id shows nothing until it is put', () => {
    const png = Buffer.from(encodePng(red(1), 1, 1)).toString('base64');
    const read = createKittyGraphics();
    expect(feed(`${ESC}_Ga=t,f=100,i=7;${png}${ESC}\\`, read)).toEqual([]);
    const [put] = feed(`${ESC}_Ga=p,i=7,c=4${ESC}\\`, read);
    expect([put?.width, put?.cols]).toEqual([1, 4]);
  });

  test('queries, deletes, other APC strings and broken data are dropped', () => {
    expect(
      feed(
        [
          `${ESC}_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA${ESC}\\`,
          `${ESC}_Ga=d${ESC}\\`,
          `${ESC}_Xsomething else${ESC}\\`,
          `${ESC}_Ga=T,f=32,s=10,v=10;AAAA${ESC}\\`,
          `${ESC}_Ga=T,f=24,o=z,s=1,v=1;bm90IHpsaWI=${ESC}\\`,
        ].join(''),
      ),
    ).toEqual([]);
  });
});

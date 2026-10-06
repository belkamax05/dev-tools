import { describe, expect, test } from 'bun:test';
import { inflateSync } from 'node:zlib';
import createBrailleCanvas from './createBrailleCanvas.ts';
import createCellCanvas from './createCellCanvas.ts';
import createHalfBlockCanvas from './createHalfBlockCanvas.ts';
import createRasterCanvas from './createRasterCanvas.ts';
import createSextantCanvas from './createSextantCanvas.ts';
import decodePng from './decodePng.ts';
import encodeKittyImage from './encodeKittyImage.ts';
import encodePng from './encodePng.ts';
import encodeSixelImage from './encodeSixelImage.ts';
import flattenImage from './flattenImage.ts';
import resampleImage from './resampleImage.ts';
import renderSphereScene from './scenes/renderSphereScene.ts';

const ESC = String.fromCharCode(27);
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** First visible glyph of a rendered canvas, as a hex codepoint. */
function firstGlyph(rendered: string): string {
  const stripped = rendered.replace(SGR, '');
  return [...stripped][0]?.codePointAt(0)?.toString(16) ?? '';
}

describe('canvas footprints', () => {
  // Every technique must occupy the same rectangle for a given cols x rows, or
  // demoLadder's side-by-side comparison is not comparing like with like.
  test.each([
    ['cell', createCellCanvas(20, 10), 20, 10],
    ['half block', createHalfBlockCanvas(20, 10), 20, 20],
    ['sextant', createSextantCanvas(20, 10), 40, 30],
    ['braille', createBrailleCanvas(20, 10), 40, 40],
  ])('%s resolves to %i cols and the right pixel grid', (_name, canvas, width, height) => {
    expect(canvas.cols).toBe(20);
    expect(canvas.rows).toBe(10);
    expect(canvas.width).toBe(width);
    expect(canvas.height).toBe(height);
    expect(canvas.render().split('\n')).toHaveLength(10);
  });

  test("pixelAspect makes every technique agree on the scene's shape", () => {
    // physical width / physical height, in units where a cell is 1 x 2.
    const shape = (c: { width: number; height: number; pixelAspect: number }) =>
      (c.width * c.pixelAspect) / c.height;
    const expected = 20 / (10 * 2);
    for (const canvas of [
      createCellCanvas(20, 10),
      createHalfBlockCanvas(20, 10),
      createSextantCanvas(20, 10),
      createBrailleCanvas(20, 10),
    ]) {
      expect(shape(canvas)).toBeCloseTo(expected, 10);
    }
  });
});

describe('glyph tables', () => {
  test('braille dot bits are not in raster order', () => {
    const probe = (px: number, py: number) => {
      const canvas = createBrailleCanvas(1, 1, {
        dither: false,
        threshold: 0.02,
      });
      canvas.clear(0, 0, 0);
      canvas.set(px, py, 255, 255, 255);
      return firstGlyph(canvas.render());
    };
    expect(probe(0, 0)).toBe('2801'); // dot 1
    expect(probe(1, 0)).toBe('2808'); // dot 4
    expect(probe(0, 3)).toBe('2840'); // dot 7, appended to the 6-dot standard
    expect(probe(1, 3)).toBe('2880'); // dot 8
  });

  test('sextants skip the two patterns that are already half blocks', () => {
    const canvas = createSextantCanvas(1, 1);
    const probe = (mask: number) => {
      canvas.clear(0, 0, 0);
      for (let n = 0; n < 6; n++) {
        if (mask & (1 << n)) canvas.set(n % 2, Math.floor(n / 2), 255, 255, 255);
      }
      return firstGlyph(canvas.render());
    };
    expect(probe(1)).toBe('1fb00');
    expect(probe(20)).toBe('1fb13');
    expect(probe(21)).toBe('258c'); // left half block, not in the sextant range
    expect(probe(22)).toBe('1fb14'); // resumes, shifted down by one
    expect(probe(41)).toBe('1fb27');
    expect(probe(42)).toBe('2590'); // right half block
    expect(probe(43)).toBe('1fb28'); // shifted down by two
    expect(probe(62)).toBe('1fb3b');
    expect(probe(63)).toBe('2588'); // full block
  });
});

describe('encodeSixelImage', () => {
  /**
   * Independent decoder, deliberately not sharing code with the encoder.
   *
   * It models P2 background semantics, which is the whole point: under the
   * default P2=0 a 0 bit paints the background, so each colour pass erases the
   * ones before it and a multi-colour band decodes to nearly nothing. A decoder
   * that ignores P2 will happily "verify" an encoder that produces a blank
   * image on real terminals.
   */
  function decodeSixel(data: string) {
    const intro = new RegExp(`^${ESC}P([0-9;]*)q`).exec(data);
    if (!intro) throw new Error('missing DCS introducer');
    expect(data.endsWith(`${ESC}\\`)).toBe(true);
    const params = (intro[1] as string).split(';');
    const p2 = Number(params[1] ?? 0);
    const zeroBitsPaintBackground = p2 !== 1;
    let body = data.slice(intro[0].length, -2);

    const raster = /^"(\d+);(\d+);(\d+);(\d+)/.exec(body);
    if (!raster) throw new Error('missing raster attributes');
    const width = Number(raster[3]);
    const height = Number(raster[4]);
    body = body.slice(raster[0].length);

    const palette = new Map<number, [number, number, number]>();
    const pixels = new Map<string, number>();
    let i = 0;
    let x = 0;
    let band = 0;
    let colour = 0;

    while (i < body.length) {
      const ch = body[i] as string;
      if (ch === '#') {
        const m = /^#(\d+)(?:;(\d+);(\d+);(\d+);(\d+))?/.exec(body.slice(i));
        if (!m) throw new Error('bad colour introducer');
        colour = Number(m[1]);
        if (m[2]) {
          palette.set(colour, [Number(m[3]), Number(m[4]), Number(m[5])]);
        }
        i += m[0].length;
        continue;
      }
      if (ch === '$') {
        x = 0;
        i++;
        continue;
      }
      if (ch === '-') {
        x = 0;
        band++;
        i++;
        continue;
      }
      let repeat = 1;
      let glyph = ch;
      if (ch === '!') {
        const m = /^!(\d+)/.exec(body.slice(i));
        if (!m) throw new Error('bad repeat');
        repeat = Number(m[1]);
        i += m[0].length;
        glyph = body[i] as string;
      }
      const mask = glyph.charCodeAt(0) - 63;
      expect(mask).toBeGreaterThanOrEqual(0);
      expect(mask).toBeLessThan(64);
      for (let n = 0; n < repeat; n++) {
        for (let dy = 0; dy < 6; dy++) {
          const key = `${x},${band * 6 + dy}`;
          if (mask & (1 << dy)) pixels.set(key, colour);
          else if (zeroBitsPaintBackground) pixels.delete(key);
        }
        x++;
      }
      i++;
    }
    return { width, height, palette, pixels, p2 };
  }

  test('round-trips exactly, including a ragged final band', () => {
    // 40 is not a multiple of 6, so the last band is short.
    const width = 61;
    const height = 40;
    const raster = createRasterCanvas(width, height);
    renderSphereScene(raster, { time: 0.9 });
    const rgb = raster.toRgb();

    const decoded = decodeSixel(encodeSixelImage(rgb, width, height));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Without this the multi-pass bands below erase each other on real hardware.
    expect(decoded.p2).toBe(1);

    const cube = (v: number) => Math.round((v / 255) * 5);
    let missing = 0;
    let wrong = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 3;
        const want =
          cube(rgb[o] as number) * 36 + cube(rgb[o + 1] as number) * 6 + cube(rgb[o + 2] as number);
        const got = decoded.pixels.get(`${x},${y}`);
        if (got === undefined) missing++;
        else if (got !== want) wrong++;
      }
    }
    expect(missing).toBe(0);
    expect(wrong).toBe(0);
  });

  test('the decoder would catch a P2=0 regression', () => {
    // Guards the guard: rewrite the header to the buggy default and confirm a
    // multi-colour image really does decode to almost nothing.
    const width = 24;
    const height = 12;
    const raster = createRasterCanvas(width, height);
    renderSphereScene(raster, { time: 0.9 });
    const correct = encodeSixelImage(raster.toRgb(), width, height);
    const buggy = correct.replace(`${ESC}P0;1;0q`, `${ESC}Pq`);

    expect(decodeSixel(correct).pixels.size).toBe(width * height);
    expect(decodeSixel(buggy).pixels.size).toBeLessThan(width * height * 0.5);
  });

  test('palette entries are percentages, not 0-255', () => {
    const rgb = new Uint8Array([255, 255, 255, 0, 0, 0]);
    const decoded = decodeSixel(encodeSixelImage(rgb, 2, 1));
    for (const [, [r, g, b]] of decoded.palette) {
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(100);
    }
    expect([...decoded.palette.values()]).toContainEqual([100, 100, 100]);
  });
});

describe('encodeKittyImage', () => {
  /** The payload chunks, in order, with the control keys each one carried. */
  function chunksOf(out: string) {
    return [...out.matchAll(new RegExp(`${ESC}_G([^;]*);([^${ESC}]*)${ESC}\\\\`, 'g'))];
  }

  test('chunks at 4096 bytes with correct continuation flags', () => {
    const width = 40;
    const height = 30;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 0xff;

    const out = encodeKittyImage(rgba, width, height, { cols: 20, rows: 10 });
    const chunks = chunksOf(out);

    expect(chunks.length).toBeGreaterThan(1);
    // q=2 suppresses the terminal's per-frame acknowledgement, which would
    // otherwise arrive on stdin and be read as keystrokes.
    expect(chunks[0]?.[1]).toBe('a=T,f=32,s=40,v=30,c=20,r=10,q=2,m=1');
    // Control keys ride on the first chunk only.
    expect(chunks.at(-1)?.[1]).toBe('m=0');
    for (const chunk of chunks) expect((chunk[2] as string).length).toBeLessThanOrEqual(4096);

    const reassembled = Buffer.from(chunks.map((c) => c[2]).join(''), 'base64');
    expect(Buffer.from(rgba).equals(reassembled)).toBe(true);
  });

  test('does not compress unless asked, because Ghostty segfaults on o=z', () => {
    // A regression guard with a crash behind it. Ghostty answers the graphics
    // handshake exactly as kitty does, so nothing upstream of here can catch a
    // default that flips back on — the symptom is the user's terminal dying.
    const rgba = new Uint8Array(8 * 8 * 4);
    const out = encodeKittyImage(rgba, 8, 8, { cols: 4, rows: 2 });
    expect(out).not.toContain('o=z');
  });

  test('deflates when asked, declaring o=z', () => {
    const width = 256;
    const height = 256;
    // A scene rather than noise: this path exists for pictures, and a picture
    // is what actually compresses.
    const canvas = createRasterCanvas(width, height);
    renderSphereScene(canvas, { time: 0.7 });
    const rgba = canvas.rgba;

    const out = encodeKittyImage(rgba, width, height, {
      cols: 32,
      rows: 16,
      compress: true,
    });
    const chunks = chunksOf(out);

    expect(chunks[0]?.[1]).toContain('o=z');
    // s/v still describe the inflated pixels, not the bytes on the wire.
    expect(chunks[0]?.[1]).toContain('s=256,v=256');

    const payload = Buffer.from(chunks.map((c) => c[2]).join(''), 'base64');
    // RFC 1950, not raw deflate — the container the protocol asks for. Bun's
    // own deflateSync cannot emit this, which is why the encoder uses node's.
    expect(payload[0]).toBe(0x78);
    expect(Buffer.from(inflateSync(payload)).equals(Buffer.from(rgba))).toBe(true);
    // A shaded sphere this size gives back about four fifths, and more of it
    // the larger the canvas gets. Kept working, and kept tested, for the day
    // Ghostty can take it — the saving is real, it is just unusable today.
    expect(payload.length).toBeLessThan(rgba.length / 3);
  });

  test('carries an image id so animation frames replace rather than stack', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    const withId = encodeKittyImage(rgba, 4, 4, { id: 9001 });
    expect(withId).toContain('i=9001');
    // Without an id every frame would add a placement the terminal keeps.
    expect(encodeKittyImage(rgba, 4, 4)).not.toContain('i=');
  });
});

describe('decodePng', () => {
  // A real-file decode, of PNGs that exercise every scanline filter, lives with
  // the apps that own such files — agenti decodes its logos in
  // src/ui/logo/index.test.ts.

  test('round-trips through encodePng', () => {
    const width = 23;
    const height = 11;
    const raster = createRasterCanvas(width, height);
    renderSphereScene(raster, { time: 1.7 });
    const decoded = decodePng(encodePng(raster.rgba, width, height));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect([...decoded.rgba]).toEqual([...raster.rgba]);
  });

  test('rejects interlaced PNGs instead of decoding them wrong', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4), 4, 4);
    png[8 + 8 + 12] = 1; // IHDR interlace byte
    expect(() => decodePng(png)).toThrow(/interlac/i);
  });
});

describe('image resizing and compositing', () => {
  test('flattenImage composites transparency over the background', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 128]);
    const flat = flattenImage({ width: 3, height: 1, rgba }, [0, 0, 255]);
    expect([...flat.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255]); // opaque, unchanged
    expect([...flat.rgba.slice(4, 8)]).toEqual([0, 0, 255, 255]); // fully transparent
    const half = [...flat.rgba.slice(8, 12)];
    expect(half[0]).toBeCloseTo(128, -1); // halfway between red and blue
    expect(half[3]).toBe(255);
  });

  test('resampleImage ignores the colour under fully transparent pixels', () => {
    // White stored under alpha 0 next to an opaque black pixel. Averaging the
    // white in would lighten the result; alpha weighting must discard it.
    const rgba = new Uint8Array([255, 255, 255, 0, 0, 0, 0, 255]);
    const out = resampleImage({ width: 2, height: 1, rgba }, 1, 1);
    expect([...out.rgba.slice(0, 3)]).toEqual([0, 0, 0]);
    expect(out.rgba[3]).toBe(128); // mean coverage of the two source pixels
  });

  test('resampleImage box-averages rather than dropping pixels', () => {
    const rgba = new Uint8Array([0, 0, 0, 255, 200, 200, 200, 255]);
    const out = resampleImage({ width: 2, height: 1, rgba }, 1, 1);
    expect(out.rgba[0]).toBe(100);
  });
});

describe('encodePng', () => {
  test('IDAT is a real zlib stream, not the raw DEFLATE Bun returns', () => {
    const width = 17;
    const height = 9;
    const raster = createRasterCanvas(width, height);
    renderSphereScene(raster, { time: 0.4 });
    const png = encodePng(raster.rgba, width, height);

    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const chunks = new Map<string, Uint8Array>();
    let offset = 8;
    while (offset < png.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
      chunks.set(type, png.slice(offset + 8, offset + 8 + length));
      offset += 12 + length;
    }
    expect([...chunks.keys()]).toEqual(['IHDR', 'IDAT', 'IEND']);

    const idat = chunks.get('IDAT') as Uint8Array;
    expect(idat[0]).toBe(0x78);
    // A zlib header is only valid if the two bytes together are a multiple of 31.
    expect((((idat[0] as number) << 8) | (idat[1] as number)) % 31).toBe(0);

    // The real check: a standard decoder must accept it.
    const inflated = inflateSync(Buffer.from(idat));
    expect(inflated.length).toBe((width * 4 + 1) * height);

    // Every scanline carries filter byte 0, and pixel data survives intact.
    for (let y = 0; y < height; y++) expect(inflated[y * (width * 4 + 1)]).toBe(0);
    const firstPixel = [...inflated.subarray(1, 5)];
    expect(firstPixel).toEqual([...raster.rgba.slice(0, 4)]);
  });
});

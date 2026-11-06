import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import encodePng from '@/dev-tools/terminal-canvas/encodePng';
import type { InlineImage } from '@/dev-tools/ui/terminal/ansi/parse';

type Keys = Record<string, string>;

/** `a=T,f=100,m=1` → `{ a: 'T', f: '100', m: '1' }` */
const keysOf = (control: string): Keys =>
  Object.fromEntries(
    control
      .split(',')
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf('=');
        return at === -1 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
      }),
  );

const positive = (value?: string) => {
  const n = Number(value);
  return n > 0 ? n : undefined;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG's size, read from its IHDR chunk; undefined when the bytes are not a PNG. */
const pngSize = (bytes: Uint8Array) => {
  if (bytes.length < 24 || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const rgbToRgba = (rgb: Uint8Array, pixels: number) => {
  const rgba = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    rgba[i * 4] = rgb[i * 3] as number;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] as number;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] as number;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
};

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

/**
 * One whole transmission as a PNG image. Direct data (`t=d`) and files (`t=f`, `t=t`, the payload
 * being the path) are read; shared memory (`t=s`) cannot be, from another process's capture.
 * @throws On a payload that does not inflate, or a file that cannot be read
 */
const decode = (keys: Keys, payload: string): InlineImage | undefined => {
  const medium = keys.t ?? 'd';
  let data: Uint8Array;
  if (medium === 'd') data = Buffer.from(payload, 'base64');
  else if (medium === 'f' || medium === 't')
    data = readFileSync(Buffer.from(payload, 'base64').toString());
  else return undefined;
  if (keys.o === 'z') data = inflateSync(data);

  const format = keys.f ?? '32';
  if (format === '100') {
    const size = pngSize(data);
    return size && { src: dataUrl(data), ...size };
  }
  const bytesPerPixel = format === '24' ? 3 : format === '32' ? 4 : 0;
  const width = positive(keys.s);
  const height = positive(keys.v);
  if (!bytesPerPixel || !width || !height) return undefined;
  const pixels = width * height;
  if (data.length < pixels * bytesPerPixel) return undefined;
  const rgba = bytesPerPixel === 4 ? data.subarray(0, pixels * 4) : rgbToRgba(data, pixels);
  return { src: dataUrl(encodePng(rgba, width, height)), width, height };
};

/**
 * A reader for kitty graphics protocol commands (`ESC _G <keys>;<payload> ESC \`), as
 * `parseAnsi`'s `onApc`: it returns an image wherever one is displayed. It keeps state across
 * calls — chunks (`m=1`) are joined until the last, and images sent with an id (`a=t,i=…`) are
 * kept for a later `a=p,i=…` — so use a fresh one per stream.
 *
 * Read: transmit-and-display (`a=T`), transmit (`a=t`), put (`a=p`); RGB, RGBA and PNG (`f=24`,
 * `32`, `100`); zlib (`o=z`); placement size in cells (`c=`, `r=`). Everything else - queries,
 * deletes, animation, unicode placeholders - is dropped, as is anything that does not decode.
 */
export const createKittyGraphics = () => {
  const stored = new Map<string, InlineImage>();
  let pending: { keys: Keys; payload: string } | undefined;

  return (body: string): InlineImage | undefined => {
    if (!body.startsWith('G')) return undefined;
    const split = body.indexOf(';');
    const chunkKeys = keysOf(split === -1 ? body.slice(1) : body.slice(1, split));
    const payload = split === -1 ? '' : body.slice(split + 1);
    //? Control keys ride on the first chunk only; the rest just add payload
    if (pending) pending.payload += payload;
    else pending = { keys: chunkKeys, payload };
    if (chunkKeys.m === '1') return undefined;

    const { keys, payload: whole } = pending;
    pending = undefined;
    const place = (image?: InlineImage) =>
      image && { ...image, cols: positive(keys.c), rows: positive(keys.r) };

    const action = keys.a ?? 't';
    if (action === 'p') return keys.i ? place(stored.get(keys.i)) : undefined;
    if (action !== 't' && action !== 'T') return undefined;
    let image: InlineImage | undefined;
    try {
      image = decode(keys, whole);
    } catch {
      return undefined;
    }
    if (image && keys.i) stored.set(keys.i, image);
    return action === 'T' ? place(image) : undefined;
  };
};

export default createKittyGraphics;

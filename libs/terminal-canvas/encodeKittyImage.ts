import { deflateSync } from 'node:zlib';

/**
 * Kitty graphics protocol — genuine RGBA pixels, no cell quantisation.
 *
 *   ESC _G <key=value,...> ; <base64 payload> ESC \
 *
 * The payload must be split into chunks of at most 4096 base64 bytes. Every
 * chunk except the last carries `m=1` ("more follows"); the terminator is a
 * chunk with `m=0`, which may be empty. Control keys ride on the first chunk
 * only.
 *
 * Supported by kitty, Ghostty, WezTerm and Konsole.
 */
export interface KittyImageOptions {
  /** Scale the image into this many terminal columns. */
  cols?: number;
  /** Scale the image into this many terminal rows. */
  rows?: number;
  /** Leave the cursor where the image started instead of after it. */
  preserveCursor?: boolean;
  /**
   * Reuse a fixed image id. Re-transmitting with the same id replaces the
   * previous image; without one, every frame of an animation adds a placement
   * and the terminal slowly fills up.
   */
  id?: number;
  /** Suppress the terminal's OK/error replies, which would land on stdin. */
  quiet?: boolean;
  /**
   * Deflate the pixels before base64 (`o=z`).
   *
   * **Off by default, and it must stay that way.** See the note below: this is
   * a protocol feature that a terminal claiming kitty support can still crash
   * on, and nothing in the handshake says which.
   */
  compress?: boolean;
}

const CHUNK = 4096;

/**
 * Why the payload goes down the wire raw, at about 5.5 base64 bytes per pixel.
 *
 * The protocol has an answer for that — `o=z`, RFC 1950 deflate, which takes
 * about nine tenths of it away for two milliseconds of CPU. It is switched off
 * anyway, because **Ghostty 1.3.0-dev segfaults on the first compressed frame**.
 * Measured here, not inferred: five variants against a real Ghostty window, and
 * every compressed one died with SIGSEGV within a second while every
 * uncompressed one ran its full 200 frames. Size and frame rate made no
 * difference; `o=z` alone was the trigger.
 *
 * There is no way to ask a terminal about this. Ghostty answers the graphics
 * handshake exactly as kitty does, so `support.kitty` is true and a crash is
 * what tells you the difference. That makes compression opt-in per caller and
 * not a default, and it is why the animated path pays for its frames with
 * resolution instead — see ANIMATED_PIXEL_BUDGET in useRasterOverlay.
 */
const DEFLATE_LEVEL = 1;

export function encodeKittyImage(
  rgba: Uint8Array,
  width: number,
  height: number,
  options: KittyImageOptions = {},
): string {
  const { cols, rows, preserveCursor = false, id, quiet = true, compress = false } = options;
  // `Bun.deflateSync` emits *raw* deflate with no option to change it, and the
  // protocol asks for the RFC 1950 container — so this one goes through node's
  // zlib, which writes the header and Adler-32 in C rather than in a loop here.
  const payload = Buffer.from(
    compress ? deflateSync(rgba, { level: DEFLATE_LEVEL }) : rgba,
  ).toString('base64');

  const control = [
    'a=T', // transmit and display
    'f=32', // 32 bits per pixel: RGBA
    `s=${width}`,
    `v=${height}`,
  ];
  // Only zlib is defined, and only for the payload — the geometry keys above
  // still describe the pixels as they will be after the terminal inflates them.
  if (compress) control.push('o=z');
  if (id !== undefined) control.push(`i=${id}`);
  if (cols) control.push(`c=${cols}`);
  if (rows) control.push(`r=${rows}`);
  if (preserveCursor) control.push('C=1');
  // q=2 suppresses both OK and error replies. Without it the terminal writes an
  // acknowledgement to stdin for every frame, which an app reading keystrokes
  // then has to filter out.
  if (quiet) control.push('q=2');

  let out = '';
  for (let offset = 0; offset < payload.length; offset += CHUNK) {
    const chunk = payload.slice(offset, offset + CHUNK);
    const isFirst = offset === 0;
    const isLast = offset + CHUNK >= payload.length;
    const keys = isFirst ? [...control, `m=${isLast ? 0 : 1}`] : [`m=${isLast ? 0 : 1}`];
    out += `\x1b_G${keys.join(',')};${chunk}\x1b\\`;
  }
  return out;
}

export default encodeKittyImage;

/**
 * "Ink has just drawn a frame" — for whatever paints over Ink's output.
 *
 * A raster image (see `useRasterOverlay`) lives outside Ink's frame, and a
 * frame can erase it: Ink clears the whole screen when output height crosses
 * the terminal's. A component repainting after its *own* renders misses every
 * frame some other component caused — a list in a view moving its cursor under
 * a logo drawn by the app around it. `runTuiApp` hands Ink's `onRender` to
 * `emitFrame`, and an overlay listens here to repaint after any frame at all.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export const emitFrame = (): void => {
  for (const listener of listeners) listener();
};

export const onFrame = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let erasures = 0;

/** Erases that take images with them: whole lines, the whole screen, or the screen itself. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: match terminal ANSI erase sequences
const ERASING = /\u001B\[(?:[012]?[KJ]|\?1049[hl])/;

/**
 * The screen, or lines of it, were erased — and with them, on xterm.js, the images there. An
 * overlay that sends its picture only when it has to compares this count with the one it painted
 * at. Ink also erases the remainder of changed lines during incremental rendering. Those erases
 * can remove image cells too, so every erase mode invalidates the cached placement.
 */
export const noteScreenErased = (): void => {
  erasures += 1;
};

export const screenErasures = (): number => erasures;

/**
 * Count the erases written to `stream` — Ink's frame clears among them, which it makes with no
 * other signal — and every resize. Returns the function that stops watching.
 */
export const watchForErasures = (stream: NodeJS.WriteStream) => {
  const write = stream.write;
  let pendingEscape = '';
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : '';
    if (text) {
      const combined = pendingEscape + text;
      if (ERASING.test(combined)) noteScreenErased();
      // A stream may split a CSI sequence between writes.
      const tail = combined.slice(combined.lastIndexOf('\u001B'));
      // biome-ignore lint/suspicious/noControlCharactersInRegex: retain a split ANSI escape sequence
      pendingEscape = /^\u001B(?:\[[0-9;?]*)?$/.test(tail) ? tail : '';
    }
    return (write as (...args: unknown[]) => boolean).call(stream, chunk, ...rest);
  }) as typeof stream.write;
  stream.on('resize', noteScreenErased);
  return () => {
    stream.write = write;
    stream.off('resize', noteScreenErased);
  };
};

export default onFrame;

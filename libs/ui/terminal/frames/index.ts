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
const ERASING = /\u001B\[2K|\u001B\[2J|\u001B\[\?1049[hl]/;

/**
 * The screen, or lines of it, were erased — and with them, on xterm.js, the images there. An
 * overlay that sends its picture only when it has to compares this count with the one it painted
 * at. Ink rewrites changed lines by writing over them (see `runTuiApp`), so this moves only when it
 * clears its whole frame, on a resize, and on an overlay's own wipe.
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
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string' && ERASING.test(chunk)) noteScreenErased();
    return (write as (...args: unknown[]) => boolean).call(stream, chunk, ...rest);
  }) as typeof stream.write;
  stream.on('resize', noteScreenErased);
  return () => {
    stream.write = write;
    stream.off('resize', noteScreenErased);
  };
};

export default onFrame;

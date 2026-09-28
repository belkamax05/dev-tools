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

export default onFrame;

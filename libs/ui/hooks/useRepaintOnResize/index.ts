import { useStdout } from 'ink';
import { useEffect, useRef } from 'react';

import { ESC } from '../../terminal/ansi';
import { emitFrame } from '../../terminal/frames';
import useTerminalSize from '../useTerminalSize';

/** Quiet time after the last resize event before the frame is redrawn whole. */
const SETTLE_MS = 80;

/** Wipe the screen and home the cursor — the frame Ink rewrites after it starts at row 1. */
const WIPE = `${ESC}[2J${ESC}[H`;

/**
 * Redraw the whole frame from the top-left once a resize settles.
 *
 * Ink draws incrementally (see `runTuiApp`): it walks the cursor *up* from where it
 * believes the frame ends and rewrites only the lines that changed. A resize breaks
 * that belief — the terminal reflows or scrolls what is on screen, and Ink's own
 * resize handling only resets on a width decrease, and then with relative erases
 * that start from the wrong row. Lines that did not change, which is the header
 * and the tabs above all, are then never rewritten, and stay wherever the reflow
 * left them: wrapped, doubled, or a row out of place.
 *
 * `useStdout().write` is Ink's own way out of that: it clears its log, writes
 * what it is given, and rewrites the last frame in full. Given a screen wipe and
 * a home, the frame lands on a blank screen at row 1, and Ink's idea of where it
 * is matches the terminal again. Debounced, so a window being dragged is
 * repainted once it stops rather than on every event; by then React has
 * re-rendered for the new size and Ink's last frame is the one that fits.
 */
export const useRepaintOnResize = (): void => {
  const { columns, rows } = useTerminalSize();
  const { stdout, write } = useStdout();
  const settled = useRef(false);

  useEffect(() => {
    //? The size the app opens at is not a resize; the alternate screen was just wiped
    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (!stdout.isTTY) return;
    const timer = setTimeout(() => {
      write(WIPE);
      //? The wipe took any raster overlay with it, and Ink drew no frame to tell it so
      emitFrame();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [columns, rows, stdout, write]);
};

export default useRepaintOnResize;

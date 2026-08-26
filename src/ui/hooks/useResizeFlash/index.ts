import { useEffect, useRef, useState } from 'react';

import { useTuiTheme } from '../../providers/TuiThemeProvider';
import useTerminalSize from '../useTerminalSize';

/**
 * Whether the terminal changed size recently enough to still be saying so.
 *
 * btop's behaviour: the size appears while a window edge is being dragged and
 * fades once it stops. Each resize restarts the clock, so dragging holds the
 * readout up rather than strobing it.
 *
 * The size the app opens at is not a resize and does not flash — nobody needs
 * telling how big the window they just opened is.
 */
export const useResizeFlash = (durationMs?: number): boolean => {
  const { columns, rows } = useTerminalSize();
  const theme = useTuiTheme();
  const duration = durationMs ?? theme.timings.resizeFlash ?? 900;
  const [visible, setVisible] = useState(false);
  const settled = useRef(false);

  //? `columns` and `rows` are the trigger, not inputs: nothing in the body reads
  //? them, and the effect exists precisely to fire when they change. The lint
  //? rule's "extra dependency" fix would leave a flash that never flashes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the size is the trigger
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [columns, rows, duration]);

  return visible;
};

export default useResizeFlash;

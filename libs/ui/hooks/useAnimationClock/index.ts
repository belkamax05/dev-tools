import { useEffect, useRef, useState } from 'react';

/**
 * Seconds since the clock started, ticking at `fps`, or held where it is when
 * `enabled` goes false.
 *
 * Switching it off matters more in a TUI than in a standalone demo. Every tick
 * re-renders the whole app — tab strip, footer and all — so a clock that runs
 * for a static picture costs a full Yoga pass and, in raster mode, re-transmits
 * the entire bitmap down the pty for no visible change.
 *
 * Held rather than reset, because the caller's other reason to stop the clock is
 * a pause key, and a pause that snaps the picture back to its first frame reads
 * as a bug rather than as a pause.
 */
export const useAnimationClock = (enabled: boolean, fps: number): number => {
  const [time, setTime] = useState(0);
  //? Read by the effect to resume from, without making every tick tear the
  //? interval down and build a new one.
  const timeRef = useRef(0);
  timeRef.current = time;

  useEffect(() => {
    if (!enabled) return;
    const started = performance.now() - timeRef.current * 1000;
    const id = setInterval(
      () => setTime((performance.now() - started) / 1000),
      Math.max(1, Math.round(1000 / fps)),
    );
    return () => clearInterval(id);
  }, [enabled, fps]);

  return time;
};

export default useAnimationClock;

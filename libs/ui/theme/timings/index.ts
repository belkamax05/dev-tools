/**
 * How long the interface holds something on screen, in milliseconds.
 *
 * The MUI analogue is `theme.transitions.duration`. A terminal has no
 * transitions — nothing eases, a frame is simply drawn or not — so these are
 * durations for things that show up and then stop showing up.
 *
 * Timings that belong to a *device* rather than to the interface (how often
 * something is polled, how long a reply may take) are not theme: they are what
 * the thing does, and they live with the code that talks to it.
 */
export const timings = {
  /**
   * How long a size readout stays up after the terminal stops changing size.
   * Long enough to read while dragging a window edge, short enough that it is
   * gone before it becomes something to dismiss.
   */
  resizeFlash: 900,
  /**
   * The floor under "something is happening".
   *
   * Most operations answer in tens of milliseconds, so the line telling you one
   * is in flight was drawn and erased inside a single blink — a flicker over the
   * text you were reading, which is worse than never having said anything. Held
   * this long whether or not it took that long, because the point of the line is
   * to be read, and a slow operation simply holds it longer.
   */
  working: 1000,
} satisfies Record<string, number>;

export type Timings = Record<string, number>;

export default timings;

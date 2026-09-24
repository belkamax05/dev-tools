import detectGraphicsSupport, { type GraphicsSupport } from './detectGraphicsSupport.ts';

/**
 * What this terminal can draw, probed once at startup.
 *
 * It has to be once, and it has to be early. Detection writes three queries to
 * the terminal and reads the replies off stdin in raw mode — and by the time the
 * TUI is running, stdin belongs to the input filter and Ink. A reply arriving
 * then is not a reply, it is a fistful of garbage keystrokes delivered to
 * whichever view is listening.
 *
 * So `probeGraphicsSupport` runs before Ink is handed stdin, and everything
 * afterwards reads the cached answer with `graphicsSupport()`.
 */

/**
 * What is claimed when nothing was probed — a test, or any caller that mounted
 * its TUI without probing first.
 *
 * Claiming nothing rather than guessing from `$TERM`: an unprobed terminal that
 * is told it speaks sixel emits a DCS into a terminal that discards it, which
 * looks exactly like a broken encoder. The Debug tab's [f] is the way to try a
 * protocol anyway.
 */
const UNPROBED: GraphicsSupport = {
  kitty: false,
  sixel: false,
  iterm2: false,
  truecolor: true,
  cellWidth: 10,
  cellHeight: 20,
  cellSizeSource: 'assumed',
  terminal: process.env.TERM_PROGRAM || process.env.TERM || 'unknown',
  method: 'env',
};

let probed: GraphicsSupport | undefined;

/**
 * Ask the terminal what it can do, before anything else claims stdin.
 *
 * Detection leaves stdin paused, and a paused stream does not start flowing
 * again just because a `data` listener is added — Node only auto-resumes when
 * flowing was never explicitly stopped. The TUI's stdin filter attaches exactly
 * such a listener, and Ink's `resume()` goes to the proxy stream rather than the
 * real one, so without this the keyboard would be dead for the whole session.
 */
export async function probeGraphicsSupport(): Promise<GraphicsSupport> {
  if (probed) return probed;
  probed = await detectGraphicsSupport();
  if (process.stdin.isTTY) process.stdin.resume();
  return probed;
}

/** The probe's answer, or an empty one if the probe never ran. */
export function graphicsSupport(): GraphicsSupport {
  return probed ?? UNPROBED;
}

export default probeGraphicsSupport;

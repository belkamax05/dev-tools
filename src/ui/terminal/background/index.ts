import { ESC, ST } from '../ansi';

/**
 * The terminal's own default background colour.
 *
 * Ink can only colour cells it draws, and there are three places it never
 * reaches: the row an app holds back so its frame does not scroll the screen,
 * anything a redraw has not caught up with yet, and the window padding — the
 * few pixels most terminals leave around the character grid, which belong to no
 * cell at all. All three fall back to the terminal's default background, so an
 * otherwise fully painted app still sits in a thin frame of somebody else's
 * colour.
 *
 * OSC 11 is the one lever for that: it tells the terminal what its default
 * background *is*, and OSC 111 puts the user's own back. Both are widely
 * supported — xterm, VTE, kitty, alacritty, wezterm, foot, iTerm2, Konsole,
 * Windows Terminal — and a terminal that does not know them swallows the
 * sequence rather than printing it, so this is safe to write blind.
 *
 * One caveat worth knowing: a terminal configured with a translucent background
 * usually applies that translucency to the default colour, so on those the
 * padding stays see-through while the cells Ink paints are solid. That is the
 * terminal's decision to make, not ours.
 */

/** Set the default background to `color` — a hex string or an X11 colour name. */
export const backgroundSequence = (color: string): string => `${ESC}]11;${color}${ST}`;

/** Hand the default background back to whatever the user configured. */
export const BACKGROUND_RESET = `${ESC}]111${ST}`;

/** What we last told the terminal, or null if we have told it nothing. */
let applied: string | null = null;

export const terminalBackground = (): string | null => applied;

/**
 * Claim the terminal's background, or give it back with `null`.
 *
 * Idempotent, so a component may call it on every render — an app resolves its
 * colours each frame, and an escape sequence written on every keystroke would
 * be a lot of bytes to say nothing.
 *
 * Every caller must be able to count on the reset happening: a terminal left on
 * the app's colour after the app is gone is the kind of mess a user has to
 * restart a shell to clear. `runTuiApp` resets on the way out, including on a
 * signal, and a shell component should reset on unmount as well.
 */
export const setTerminalBackground = (color: string | null): void => {
  if (color === applied) return;

  applied = color;
  if (process.stdout.isTTY) {
    process.stdout.write(color === null ? BACKGROUND_RESET : backgroundSequence(color));
  }
};

export default setTerminalBackground;

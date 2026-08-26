import { ESC } from '../ansi';

/**
 * The alternate screen buffer — the full-window workspace a TUI lives in.
 *
 * Three things happen together on the way in, and the order matters:
 *
 * - `?1049h` switches to the alternate buffer, so the app's frame never enters
 *   the shell's scrollback and the shell is untouched when the app exits.
 * - `2J` then `H` clear it and home the cursor to (1,1). The home is not
 *   decoration: the alternate screen may restore the cursor wherever it was
 *   last time, and every hit-box in `useClickable` is computed against the app
 *   starting at terminal row 1. A restored cursor two rows down shifts every
 *   click target by two rows, which reads as "hover is broken".
 * - `?25l` hides the terminal's own cursor, which otherwise sits blinking in
 *   the middle of whatever was drawn last.
 */
export const ENTER_ALT_SCREEN = `${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?25l`;
export const LEAVE_ALT_SCREEN = `${ESC}[?1049l${ESC}[?25h`;

export const enterAltScreen = (): void => {
  if (process.stdout.isTTY) process.stdout.write(ENTER_ALT_SCREEN);
};

export const leaveAltScreen = (): void => {
  if (process.stdout.isTTY) process.stdout.write(LEAVE_ALT_SCREEN);
};

export default enterAltScreen;

import type { ReactNode } from 'react';

import type { InkRender } from '../../../types/InkRender';
import { setTerminalBackground } from '../../terminal/background';
import { MOUSE_DISABLE, setMouseReporting } from '../../terminal/mouse';
import { enterAltScreen, leaveAltScreen } from '../../terminal/screen';
import { createFilteredStdin } from '../../terminal/stdinFilter';

export interface RunTuiAppOptions {
  /**
   * `render` from the caller's own ink install — see {@link InkRender}.
   *
   * Injected rather than imported so this function stays usable from a repo that
   * resolves its own `ink`: nothing here is a React component, so the only thing
   * that has to match the caller's copy is the renderer it hands us.
   */
  render: InkRender;
  /**
   * Turn terminal mouse reporting on for the life of the app.
   *
   * Off is a real setting, not a fallback: a terminal with mouse reporting on
   * will not let you select text with the pointer, and a terminal that does not
   * speak SGR mouse mode types the escape sequences into the app as garbage
   * keystrokes. Never switched on at all when this says so, rather than switched
   * on and ignored.
   */
  mouse?: boolean;
  /**
   * Run before the terminal is handed back — closing a device, flushing a file.
   *
   * Failures are swallowed. Cleanup runs on the way out of a process that is
   * leaving anyway, and a throw here would skip the escape sequences that put
   * the terminal back the way it was found.
   */
  onCleanup?: () => Promise<void> | void;
  /** Leave the process running after the app unmounts, instead of exiting. */
  keepProcessAlive?: boolean;
}

/**
 * Mount a full-screen Ink app and put the terminal back afterwards.
 *
 * The ordering here is the whole point, and every step of it is a bug somebody
 * has already had:
 *
 * - The alternate screen is entered *and homed* before the first frame, because
 *   `useClickable` converts mouse coordinates against an app that starts at
 *   terminal row 1.
 * - Mouse reporting is turned on before stdin is claimed, and off before the
 *   alternate screen is left — a shell that inherits a terminal still in mouse
 *   mode emits escape sequences on every pointer move.
 * - The background is reset even on a signal. An opaque theme changes the
 *   terminal's *own* default colour, and a shell left painted in it is a shell
 *   you have to restart to fix.
 * - Cleanup is idempotent and runs from three places (SIGINT, SIGTERM, and the
 *   `finally`), because whichever gets there first is the one that matters.
 *
 * Anything that has to read the terminal's replies — a graphics-capability probe,
 * a colour query — must finish *before* this is called. Once the input filter and
 * Ink own stdin, a reply is not a reply, it is a handful of garbage keystrokes
 * delivered to whichever view is listening.
 */
export const runTuiApp = async (
  node: ReactNode,
  { render, mouse = true, onCleanup, keepProcessAlive = false }: RunTuiAppOptions,
): Promise<void> => {
  const interactive = Boolean(process.stdout.isTTY);

  enterAltScreen();
  setMouseReporting(interactive && mouse);

  const input = createFilteredStdin(process.stdin);

  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;

    if (interactive) process.stdout.write(MOUSE_DISABLE);
    setTerminalBackground(null);
    input.dispose();
    leaveAltScreen();

    try {
      await onCleanup?.();
    } catch {
      //? Already on the way out; the terminal is what matters now.
    }

    if (!keepProcessAlive) process.exit(0);
  };

  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  try {
    const instance = render(node, {
      stdin: input.stdin,
      stdout: process.stdout,
      patchConsole: true,
      exitOnCtrlC: true,
    });
    await instance.waitUntilExit();
  } finally {
    await cleanup();
  }
};

export default runTuiApp;

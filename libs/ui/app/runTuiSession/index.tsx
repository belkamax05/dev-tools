import { spawnSync } from 'node:child_process';
import type { ReactNode } from 'react';

import type { InkRender } from '../../../types/InkRender';
import editFile from '../../../utils/system/editFile';
import runTuiApp from '../runTuiApp';

/**
 * Something a TUI cannot do inside its own frame: open a file in the user's
 * editor, or run a program that needs the terminal (an agent CLI, a pager).
 */
export type Handoff =
  | { type: 'edit'; path: string }
  | { type: 'run'; command: string[]; cwd: string; label: string };

export interface SessionFrame {
  /** Record what to do once the app has unmounted. The app then calls Ink's `exit()`. */
  handoff: (intent: Handoff) => void;
  /** What the last handoff did — "Back from editing x" — for the app to show on reopening. */
  notice?: string;
}

export interface RunTuiSessionOptions {
  render: InkRender;
  /** Runs after each handoff, before the app reopens — to reload settings the editor may have changed. */
  afterHandoff?: (intent: Handoff) => Promise<void> | void;
  /** How a handoff's result is described. Paths are shown as given unless this shortens them. */
  describe?: (intent: Handoff) => string;
}

/**
 * Run a full-screen app that can lend the terminal out and take it back.
 *
 * The app renders from `frame`; when it wants an editor or a foreground
 * program it calls `frame.handoff(...)` and exits. This then gives the
 * terminal back, runs the editor or program on it, and mounts the app again —
 * which is why an app using this keeps anything worth coming back to (the tab,
 * the selected row) outside its component state. Returns when the app exits
 * without asking for anything.
 */
export const runTuiSession = async (
  app: (frame: SessionFrame) => ReactNode,
  { render, afterHandoff, describe }: RunTuiSessionOptions,
): Promise<void> => {
  let notice: string | undefined;
  while (true) {
    let intent: Handoff | undefined;
    await runTuiApp(
      app({
        notice,
        handoff: (next) => {
          intent = next;
        },
      }),
      { render, keepProcessAlive: true },
    );
    const handoff = intent as Handoff | undefined;
    if (!handoff) return;

    if (handoff.type === 'edit') {
      editFile(handoff.path);
    } else {
      const [bin = '', ...args] = handoff.command;
      spawnSync(bin, args, { cwd: handoff.cwd, stdio: 'inherit' });
    }
    await afterHandoff?.(handoff);
    notice =
      describe?.(handoff) ??
      (handoff.type === 'edit' ? `Back from editing ${handoff.path}` : `Back from ${handoff.label}`);
  }
};

export default runTuiSession;

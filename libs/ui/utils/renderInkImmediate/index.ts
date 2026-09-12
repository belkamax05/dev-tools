import type { ReactNode } from 'react';
import type { InkInstance, InkRender, InkRenderOptions } from '../../../types/InkRender';

export interface RenderInkImmediateOptions<T = void> extends InkRenderOptions {
  /**
   * `render` from the caller's own ink install — see {@link InkRender} for why it is injected
   * instead of imported here.
   */
  render: InkRender;
  /** Erase the frame on teardown instead of leaving it in the terminal scrollback */
  clear?: boolean;
  /** Keeps the app mounted until this settles, for UIs that are not a single frame.
   Whatever it resolves with is returned to the caller, so an interactive UI can hand
   back what the user picked. The app exiting on its own ends the wait too; without it
   the app is torn down as soon as the first frame is on screen.
  */
  until?: PromiseLike<T>;
}

//? Renders an Ink element and resolves so the caller keeps going — no process.exit, and the
//? frame is left in the terminal scrollback unless `clear` is set. Use it for inline one-shot
//? Ink output and for hosting short-lived TUIs.
const renderInkImmediate = async <T = void>(
  node: ReactNode,
  { render, clear, until, ...renderOptions }: RenderInkImmediateOptions<T>,
) => {
  const instance: InkInstance = render(node, {
    //? Nothing interactive is mounted by default, and console must stay untouched for
    //? the surrounding flow — callers hosting a TUI can opt back into either
    exitOnCtrlC: false,
    patchConsole: false,
    ...renderOptions,
  });

  //? Must be requested BEFORE anything can unmount: Ink resolves only an already
  //? created exit promise, so asking for it afterwards would never settle
  const exited = instance.waitUntilExit();

  //? Racing `exited` also covers apps that call useApp().exit() themselves — those end
  //? the wait with no result. A failure is re-thrown further down, once teardown is done.
  let result: T | undefined;
  if (until) {
    result = await Promise.race([until, exited.then(() => undefined)]).catch(() => undefined);
  }

  //? Erasing by rendering an empty tree, not by instance.clear(): a frame still queued
  //? behind the render throttle gets recomputed from that empty tree when unmount()
  //? flushes it. An out-of-band clear() would let such a frame redraw the UI and erase
  //? lines that are no longer on screen.
  if (clear) instance.rerender(null);

  //? Flushes the final frame and calls log.done(), which keeps output on screen.
  //? No-op when the app already unmounted itself
  instance.unmount();

  try {
    //? Resolves once every queued stdout write landed, so later output can't interleave
    await exited;
  } finally {
    instance.cleanup();
  }

  return result;
};

export default renderInkImmediate;

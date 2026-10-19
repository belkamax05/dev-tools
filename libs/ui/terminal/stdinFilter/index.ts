import { PassThrough } from 'node:stream';

import { createInputFilter, emitMouseEvent } from '../mouse';

export interface FilteredStdin {
  /** Hand this to Ink's `render` in place of `process.stdin`. */
  stdin: NodeJS.ReadStream;
  /** Ctrl+C was pressed — the app was interrupted, not closed. */
  wasInterrupted: () => boolean;
  dispose: () => void;
}

const CTRL_C = '\u0003';

/** Kitty modifier bits that say nothing about the key: Caps Lock and Num Lock being on. */
const LOCK_BITS = 64 | 128;
const CTRL_BIT = 4;

/**
 * Ctrl+C as the kitty keyboard protocol sends it — `CSI 99 ; <modifiers> [:1] u`, Ctrl alone (a
 * lock key may be on) — written back as the `^C` byte every terminal sends without it.
 *
 * ! Ink 7 parses the kitty form, then drops it in `useInput` on the understanding that its own
 * ! `exitOnCtrlC` deals with it — which only ever compares against the raw byte. So in an app
 * ! that asked for the protocol (`runTuiApp`'s `enhancedKeyboard`), Ctrl+C did nothing at all.
 * ! Ctrl+Shift+C (copy in Linux terminals) carries Shift and is left alone, as is a release.
 */
export const normalizeInterrupt = (text: string): string =>
  text.replace(/\u001b\[99;(\d+)(?::1)?u/g, (whole, modifiers: string) =>
    ((Number(modifiers) - 1) & ~LOCK_BITS) === CTRL_BIT ? CTRL_C : whole,
  );

/**
 * Hand Ink a keyboard-only stdin.
 *
 * Mouse reports arrive on the same stream as keystrokes, and Ink would hand
 * them to `useInput` as garbage keypresses — in a keystroke log, every mouse
 * move would land as an event. So we take ownership of the real stdin, pull the
 * mouse events out, and forward the rest to Ink through a proxy that looks
 * enough like a TTY for Ink's raw-mode handling to work.
 */
export const createFilteredStdin = (source: NodeJS.ReadStream = process.stdin): FilteredStdin => {
  const proxy = new PassThrough() as unknown as NodeJS.ReadStream;
  proxy.isTTY = true;
  proxy.setRawMode = (mode: boolean) => {
    source.setRawMode?.(mode);
    return proxy;
  };
  //? Ink's useInput calls stdin.ref() / stdin.unref() to control the event loop.
  //? PassThrough doesn't have these (they're net.Socket methods), so add stubs.
  (proxy as any).ref = () => source.ref?.();
  (proxy as any).unref = () => source.unref?.();

  let interrupted = false;
  const filter = createInputFilter(emitMouseEvent, (text) => {
    const keys = normalizeInterrupt(text);
    if (keys.includes(CTRL_C)) interrupted = true;
    proxy.write(keys);
  });
  const onData = (chunk: Buffer) => filter.feed(chunk.toString('utf8'));

  //? A `data` listener only starts a stream that was never paused. One that *was* — by a prompt
  //? that ran before this app in the same process (clack closes its readline interface, and
  //? closing one pauses stdin) — stays paused, and the app draws but never hears a key or a
  //? click. Resume it explicitly, and put it back the way it was on the way out.
  const wasPaused = source.isPaused();
  source.on('data', onData);
  source.resume();
  return {
    stdin: proxy,
    wasInterrupted: () => interrupted,
    dispose: () => {
      filter.dispose();
      source.off('data', onData);
      if (wasPaused) source.pause();
      proxy.end();
    },
  };
};

export default createFilteredStdin;

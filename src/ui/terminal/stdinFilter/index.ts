import { PassThrough } from 'node:stream';

import { createInputFilter, emitMouseEvent } from '../mouse';

export interface FilteredStdin {
  /** Hand this to Ink's `render` in place of `process.stdin`. */
  stdin: NodeJS.ReadStream;
  dispose: () => void;
}

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

  const filter = createInputFilter(emitMouseEvent, (text) => proxy.write(text));
  const onData = (chunk: Buffer) => filter.feed(chunk.toString('utf8'));

  source.on('data', onData);
  return {
    stdin: proxy,
    dispose: () => {
      filter.dispose();
      source.off('data', onData);
      proxy.end();
    },
  };
};

export default createFilteredStdin;

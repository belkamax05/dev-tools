import { useStdout } from 'ink';
import { useCallback, useSyncExternalStore } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * `||` rather than `??`: a detached or unsized pty reports 0, which is not
 * nullish, and a zero-height view renders nothing at all.
 */
const measure = (stdout: NodeJS.WriteStream | undefined): TerminalSize => ({
  columns: stdout?.columns || 100,
  rows: stdout?.rows || 30,
});

const DETACHED: TerminalSize = measure(undefined);

interface SizeStore {
  size: TerminalSize;
  subscribers: Set<() => void>;
}

/**
 * One `resize` listener per stream, however many components ask for the size.
 *
 * Every strip, tab and panel consults the viewport, so a listener per caller ran
 * the stream past Node's ten-listener limit and emitted a MaxListenersExceeded
 * warning — which, in an app that owns the alternate screen, is not a log line
 * but a hole punched through the frame.
 */
const stores = new WeakMap<NodeJS.WriteStream, SizeStore>();

const storeFor = (stdout: NodeJS.WriteStream): SizeStore => {
  const existing = stores.get(stdout);
  if (existing) return existing;

  const store: SizeStore = { size: measure(stdout), subscribers: new Set() };
  stdout.on('resize', () => {
    const next = measure(stdout);
    //? A new object every resize event would re-render every consumer even when
    //? the size is unchanged; `useSyncExternalStore` compares by identity.
    if (next.columns === store.size.columns && next.rows === store.size.rows) return;
    store.size = next;
    for (const notify of store.subscribers) notify();
  });
  stores.set(stdout, store);
  return store;
};

/** Terminal size, kept current across SIGWINCH. */
export const useTerminalSize = (): TerminalSize => {
  const { stdout } = useStdout();

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!stdout) return () => {};
      const store = storeFor(stdout);
      store.subscribers.add(notify);
      return () => {
        store.subscribers.delete(notify);
      };
    },
    [stdout],
  );

  const snapshot = useCallback(() => (stdout ? storeFor(stdout).size : DETACHED), [stdout]);

  return useSyncExternalStore(subscribe, snapshot, snapshot);
};

export default useTerminalSize;

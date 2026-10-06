import type { EventEmitter } from 'node:events';
import { useStdin } from 'ink';
import { useLayoutEffect } from 'react';

type Listener = (...args: unknown[]) => void;

interface Grab {
  /** Every `useInput` listener that was there before the grab — the ones it silences. */
  muted: Set<Listener>;
}

const grabsByEmitter = new WeakMap<EventEmitter, Grab[]>();

/**
 * Route `emit('input')` past the silenced listeners while any grab is open. Installed once
 * per emitter, and a no-op with no grab: Ink's own `emit` runs untouched.
 */
const install = (emitter: EventEmitter): Grab[] => {
  const existing = grabsByEmitter.get(emitter);
  if (existing) return existing;
  const grabs: Grab[] = [];
  grabsByEmitter.set(emitter, grabs);
  const emit = emitter.emit.bind(emitter);
  emitter.emit = (event: string | symbol, ...args: unknown[]) => {
    const top = grabs.at(-1);
    if (event !== 'input' || !top) return emit(event, ...args);
    for (const listener of emitter.listeners('input') as Listener[]) {
      if (!top.muted.has(listener)) listener(...args);
    }
    return true;
  };
  return grabs;
};

/**
 * Take the keyboard: while `active`, only `useInput` handlers that subscribed *after* this
 * call hear keys — the grabbing component's own, and anything it opens. Everything already
 * listening (the shell's `q`, `t` and digits, the app's hotkeys, a list's arrows) is silent
 * until it lets go.
 *
 * For a modal that lives inside some other view — the theme editor inside a Settings tab — and
 * so cannot ask every app to pass an "input captured" flag to every handler it has. Call it
 * before the component's own `useInput`s: it snapshots in a layout effect, which runs ahead of
 * every `useInput` subscription. Grabs nest; the latest wins.
 *
 * ! A silenced handler that unsubscribes and subscribes again during the grab (its `isActive`
 * ! flipping) comes back as a new listener and is heard. Nothing that is merely re-rendered
 * ! does that — Ink keeps one listener per `useInput` for as long as `isActive` holds.
 */
export const useInputGrab = (active = true): void => {
  //? Ink's public type leaves the emitter out, but `useStdin` returns the whole context —
  //? the same object `useInput` subscribes through
  const { internal_eventEmitter: emitter } = useStdin() as unknown as {
    internal_eventEmitter?: EventEmitter;
  };
  useLayoutEffect(() => {
    if (!active || !emitter) return;
    const grabs = install(emitter);
    const grab: Grab = { muted: new Set(emitter.listeners('input') as Listener[]) };
    grabs.push(grab);
    return () => {
      const at = grabs.indexOf(grab);
      if (at !== -1) grabs.splice(at, 1);
    };
  }, [active, emitter]);
};

export default useInputGrab;

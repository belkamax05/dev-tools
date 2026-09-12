/**
 * Terminal mouse reporting.
 *
 * Ink has no mouse support: `useInput` only ever sees keystrokes, and the
 * escape sequences a terminal sends for mouse events would arrive there as
 * garbage keypresses. So this module owns the protocol end — turning reporting
 * on, parsing the events, and stripping them out of the byte stream before Ink
 * reads it.
 *
 * Wire format is SGR mouse mode (`?1006`), the only one that survives past
 * column 223: `ESC [ < button ; column ; row  M|m`, `M` for press/motion and
 * `m` for release. Coordinates are 1-based.
 */

import { ESC } from '../ansi';

export interface TerminalMouseEvent {
  type: 'press' | 'release' | 'move' | 'wheel';
  button: 'left' | 'middle' | 'right' | 'none';
  /** Wheel direction, only set when `type` is "wheel". */
  wheel?: 'up' | 'down';
  /** 1-based, as the terminal reports it. */
  column: number;
  row: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * `?1000` press/release, `?1002` motion while held, `?1003` motion always
 * (needed for hover), `?1006` SGR coordinates.
 */
export const MOUSE_ENABLE = `${ESC}[?1000h${ESC}[?1002h${ESC}[?1003h${ESC}[?1006h`;
export const MOUSE_DISABLE = `${ESC}[?1006l${ESC}[?1003l${ESC}[?1002l${ESC}[?1000l`;

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the sequence
const SGR_EVENT = /\u001B\[<(\d+);(\d+);(\d+)([Mm])/g;
/** A trailing fragment of an SGR event that hasn't fully arrived yet. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the sequence
const PARTIAL_TAIL = /\u001B(?:\[(?:<[\d;]*)?)?$/;

const decodeButton = (flags: number): Pick<TerminalMouseEvent, 'type' | 'button' | 'wheel'> => {
  if (flags & 64) {
    return { type: 'wheel', button: 'none', wheel: (flags & 1) === 0 ? 'up' : 'down' };
  }

  const button = (['left', 'middle', 'right', 'none'] as const)[flags & 3] ?? 'none';
  //? Bit 5 marks a motion report; with no button held the terminal sends 3
  //? ("none") in the low bits, which is how hover arrives.
  if (flags & 32) return { type: 'move', button };
  return { type: 'press', button };
};

/**
 * Pull every complete mouse event out of `buffer`.
 *
 * Returns the events and the bytes that are *not* mouse events, so the caller
 * can forward those on. A trailing partial sequence is held back in `rest` for
 * the next chunk rather than leaking a stray `ESC [ <` into the keyboard stream.
 */
export const parseMouseEvents = (
  buffer: string,
): { events: TerminalMouseEvent[]; passthrough: string; rest: string } => {
  const events: TerminalMouseEvent[] = [];
  let passthrough = '';
  let index = 0;

  SGR_EVENT.lastIndex = 0;
  for (let match = SGR_EVENT.exec(buffer); match !== null; match = SGR_EVENT.exec(buffer)) {
    passthrough += buffer.slice(index, match.index);
    index = match.index + match[0].length;

    const flags = Number(match[1]);
    const { type, button, wheel } = decodeButton(flags);
    events.push({
      type: match[4] === 'm' ? 'release' : type,
      button,
      ...(wheel ? { wheel } : {}),
      column: Number(match[2]),
      row: Number(match[3]),
      shift: (flags & 4) !== 0,
      alt: (flags & 8) !== 0,
      ctrl: (flags & 16) !== 0,
    });
  }

  const tail = buffer.slice(index);
  const partial = PARTIAL_TAIL.exec(tail);
  if (partial) {
    return {
      events,
      passthrough: passthrough + tail.slice(0, partial.index),
      rest: partial[0],
    };
  }
  return { events, passthrough: passthrough + tail, rest: '' };
};

/**
 * How long a trailing `ESC` is held back before it counts as the Escape key.
 *
 * `parseMouseEvents` keeps an incomplete `ESC [ < …` at the end of a chunk so a
 * mouse report split across two reads is not leaked into the keyboard stream.
 * A lone `ESC` is indistinguishable from the start of one, so pressing Escape
 * held the byte back until some *later* keystroke flushed it — Escape appeared
 * to do nothing, and then to fire one keypress late.
 *
 * The way out is the same one terminals themselves use: wait a moment, and if
 * nothing follows, it was the key. Long enough to outlast a sequence split
 * across reads on a local pty, short enough that Escape still feels immediate.
 */
export const ESCAPE_FLUSH_MS = 25;

export interface InputFilter {
  /** Feed bytes from the real stdin. */
  feed: (chunk: string) => void;
  /** Drop the pending timer. */
  dispose: () => void;
}

export interface InputFilterOptions {
  flushMs?: number;
  schedule?: (fn: () => void, ms: number) => any;
  cancel?: (handle: any) => void;
}

/**
 * Split a terminal's input into mouse events and keystrokes.
 *
 * The splitting itself is `parseMouseEvents`; what this adds is the timer that
 * releases a held-back partial when nothing follows it, so a lone Escape reaches
 * the app as the Escape key instead of waiting for the next keypress to push it
 * through. `now`-free and injectable so the timing is testable.
 */
export const createInputFilter = (
  onEvent: (event: TerminalMouseEvent) => void,
  onText: (text: string) => void,
  {
    flushMs = ESCAPE_FLUSH_MS,
    schedule = setTimeout,
    cancel = clearTimeout,
  }: InputFilterOptions = {},
): InputFilter => {
  let pending = '';
  //? Host-defined: a Node timer object in Bun, a number in a browser-like host.
  let timer: any;

  return {
    feed(chunk) {
      cancel(timer);
      const { events, passthrough, rest } = parseMouseEvents(pending + chunk);
      pending = rest;
      for (const event of events) onEvent(event);
      if (passthrough.length > 0) onText(passthrough);

      if (pending.length > 0) {
        timer = schedule(() => {
          const held = pending;
          pending = '';
          if (held.length > 0) onText(held);
        }, flushMs);
        timer?.unref?.();
      }
    },
    dispose() {
      cancel(timer);
      pending = '';
    },
  };
};

// --- pointer shape -------------------------------------------------------------

/**
 * Whether the terminal can change the mouse pointer shape (OSC 22).
 *
 * This is a kitty extension. Most terminals — VTE (GNOME Terminal, Ptyxis),
 * xterm, and VS Code's xterm.js — have no way to do it at all, so hover
 * feedback everywhere else has to be visual.
 */
export const supportsPointerShape = (
  env: Record<string, string | undefined> = process.env,
): boolean => env.TERM === 'xterm-kitty' || env.KITTY_WINDOW_ID !== undefined;

/**
 * Push a CSS pointer name onto kitty's shape stack, e.g. "pointer" for the
 * hand. Pop it with `POINTER_POP` — using the stack means the terminal's own
 * shape is restored exactly, even if the app dies mid-hover.
 */
export const pointerPush = (shape: string): string => `${ESC}]22;>${shape}${ESC}\\`;
export const POINTER_POP = `${ESC}]22;<${ESC}\\`;

// --- event bus -----------------------------------------------------------------

type Listener = (event: TerminalMouseEvent) => void;
const listeners = new Set<Listener>();

/**
 * Whether the terminal has been asked to report the mouse at all.
 *
 * Starts false because nothing has been written to the terminal yet — an app
 * turns reporting on during startup, and a settings screen can turn it off again
 * at any point after.
 */
let reporting = false;

/** Feed a parsed event to the UI. Called by the stdin filter. */
export const emitMouseEvent = (event: TerminalMouseEvent): void => {
  if (!reporting) return;
  for (const listener of listeners) listener(event);
};

export const onMouseEvent = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const isMouseReporting = (): boolean => reporting;

/**
 * Turn mouse reporting on or off, terminal and app together.
 *
 * Both halves matter. Writing `MOUSE_DISABLE` stops the terminal sending
 * anything — which is the point, since a terminal in mouse mode will not let
 * you select text with the pointer. Gating `emitMouseEvent` covers the rest: a
 * report already in flight, and anything that calls it directly.
 *
 * Idempotent, so a settings screen can call it on every render of a toggle
 * without writing escape sequences into the display.
 */
export const setMouseReporting = (enabled: boolean): void => {
  if (enabled === reporting) return;

  //? Sweep the pointer off-screen before the bus goes quiet. Hover is state each
  //? element holds for itself, so without a final "not over you" the last thing
  //? hovered would keep its highlight for as long as the app runs.
  if (!enabled) {
    emitMouseEvent({
      type: 'move',
      button: 'none',
      column: 0,
      row: 0,
      ctrl: false,
      alt: false,
      shift: false,
    });
  }

  reporting = enabled;
  if (process.stdout.isTTY) {
    process.stdout.write(enabled ? MOUSE_ENABLE : MOUSE_DISABLE);
  }
};

export default onMouseEvent;

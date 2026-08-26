import { describe, expect, test } from 'bun:test';

import {
  createInputFilter,
  parseMouseEvents,
  supportsPointerShape,
  type TerminalMouseEvent,
} from './index';

const ESC = String.fromCharCode(0x1b);
const sgr = (flags: number, column: number, row: number, end: 'M' | 'm') =>
  `${ESC}[<${flags};${column};${row}${end}`;

describe('SGR mouse parsing', () => {
  test('reads a left click', () => {
    const { events } = parseMouseEvents(sgr(0, 12, 5, 'M'));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'press',
      button: 'left',
      column: 12,
      row: 5,
      ctrl: false,
      alt: false,
      shift: false,
    });
  });

  test('distinguishes release from press', () => {
    expect(parseMouseEvents(sgr(0, 12, 5, 'm')).events[0]?.type).toBe('release');
  });

  test('reads hover motion, which carries no button', () => {
    // 32 = motion flag, low bits 3 = no button held.
    expect(parseMouseEvents(sgr(35, 40, 9, 'M')).events[0]).toMatchObject({
      type: 'move',
      button: 'none',
    });
  });

  test('reads the wheel', () => {
    expect(parseMouseEvents(sgr(64, 1, 1, 'M')).events[0]).toMatchObject({
      type: 'wheel',
      wheel: 'up',
    });
    expect(parseMouseEvents(sgr(65, 1, 1, 'M')).events[0]).toMatchObject({
      type: 'wheel',
      wheel: 'down',
    });
  });

  test('decodes modifier flags', () => {
    expect(parseMouseEvents(sgr(0 + 4 + 8 + 16, 3, 3, 'M')).events[0]).toMatchObject({
      shift: true,
      alt: true,
      ctrl: true,
    });
  });

  test('handles coordinates past the legacy 223-column limit', () => {
    //? The whole reason this decoder speaks SGR (?1006) rather than the older
    //? encodings, which cannot express a column past 223.
    expect(parseMouseEvents(sgr(0, 400, 120, 'M')).events[0]).toMatchObject({
      column: 400,
      row: 120,
    });
  });
});

describe('separating mouse bytes from keystrokes', () => {
  test('passes keystrokes through untouched', () => {
    const { events, passthrough, rest } = parseMouseEvents('hello');
    expect(events).toHaveLength(0);
    expect(passthrough).toBe('hello');
    expect(rest).toBe('');
  });

  test('strips mouse events from around keystrokes', () => {
    const { events, passthrough } = parseMouseEvents(`a${sgr(0, 1, 1, 'M')}b${sgr(0, 1, 1, 'm')}c`);
    expect(events).toHaveLength(2);
    expect(passthrough).toBe('abc');
  });

  test('leaves other escape sequences alone', () => {
    // Arrow keys must still reach Ink.
    const input = `${ESC}[A${ESC}[B`;
    const { events, passthrough } = parseMouseEvents(input);
    expect(events).toHaveLength(0);
    expect(passthrough).toBe(input);
  });

  test('holds back a sequence split across chunks', () => {
    const whole = sgr(0, 30, 7, 'M');
    const first = parseMouseEvents(`x${whole.slice(0, 6)}`);
    expect(first.events).toHaveLength(0);
    expect(first.passthrough).toBe('x');
    // The partial tail is carried over, not leaked as a keystroke.
    expect(first.rest).toBe(whole.slice(0, 6));

    const second = parseMouseEvents(first.rest + whole.slice(6) + 'y');
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({ column: 30, row: 7 });
    expect(second.passthrough).toBe('y');
  });

  test('does not swallow a lone escape keypress forever', () => {
    // ESC alone is held one chunk (it could start a mouse report), then the
    // next chunk resolves it.
    const { rest } = parseMouseEvents(ESC);
    expect(rest).toBe(ESC);
    expect(parseMouseEvents(`${rest}[A`).passthrough).toBe(`${ESC}[A`);
  });
});

describe('pointer shape support', () => {
  test('is claimed only for kitty', () => {
    expect(supportsPointerShape({ TERM: 'xterm-kitty' })).toBe(true);
    expect(supportsPointerShape({ KITTY_WINDOW_ID: '1' })).toBe(true);
    expect(supportsPointerShape({ TERM: 'xterm-256color' })).toBe(false);
    expect(supportsPointerShape({ TERM_PROGRAM: 'vscode' })).toBe(false);
  });
});

describe('createInputFilter', () => {
  /** A `setTimeout` the test drives by hand. */
  const fakeClock = () => {
    let queued: { id: number; fn: () => void }[] = [];
    let next = 1;
    return {
      schedule: (fn: () => void) => {
        const id = next++;
        queued.push({ id, fn });
        return id;
      },
      cancel: (id: number) => {
        queued = queued.filter((entry) => entry.id !== id);
      },
      tick: () => {
        const due = queued;
        queued = [];
        for (const entry of due) entry.fn();
      },
      get pending() {
        return queued.length;
      },
    };
  };

  const harness = () => {
    const clock = fakeClock();
    const events: TerminalMouseEvent[] = [];
    let text = '';
    const filter = createInputFilter(
      (event) => events.push(event),
      (chunk) => {
        text += chunk;
      },
      { schedule: clock.schedule, cancel: clock.cancel },
    );
    return { clock, events, filter, read: () => text };
  };

  test('a lone Escape reaches the app once nothing follows it', () => {
    // The bug this exists for: Escape is indistinguishable from the start of a
    // mouse report, so it was held back until some later keypress pushed it
    // through — Escape appeared dead, then fired one key late.
    const { clock, filter, read } = harness();
    filter.feed(ESC);
    expect(read()).toBe('');
    clock.tick();
    expect(read()).toBe(ESC);
  });

  test('a mouse report split across two reads is still not leaked', () => {
    const { clock, events, filter, read } = harness();
    filter.feed(`${ESC}[<0;10`);
    expect(read()).toBe('');
    expect(clock.pending).toBe(1);

    // The rest arrives before the timer fires, which is the case the hold-back
    // is there for.
    filter.feed(';20M');
    clock.tick();
    expect(read()).toBe('');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ column: 10, row: 20, type: 'press' });
  });

  test('ordinary keystrokes pass straight through', () => {
    const { filter, read } = harness();
    filter.feed('hello');
    expect(read()).toBe('hello');
  });

  test('Escape followed by a real sequence is not duplicated', () => {
    // Arrow keys are `ESC [ C`; the held ESC must be delivered as part of it,
    // exactly once.
    const { clock, filter, read } = harness();
    filter.feed(ESC);
    filter.feed('[C');
    clock.tick();
    expect(read()).toBe(`${ESC}[C`);
  });
});

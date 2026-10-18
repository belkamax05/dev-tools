import { describe, expect, test } from 'bun:test';

import { fitHints, type Hint, hintWidth, layoutHints } from './index';

/** A realistic row: eight hints, which is more than a narrow terminal can take. */
const HINTS: Hint[] = [
  { key: '↑/↓', label: 'macro' },
  { key: 'Enter', label: 'edit steps' },
  { key: 'r', label: 'rename' },
  { key: 'n', label: 'new' },
  { key: 'd', label: 'delete' },
  { key: 't', label: 'trigger' },
  { key: 'w', label: 'write' },
  { key: 'z', label: 'reload' },
];

describe('responsive hint rows', () => {
  test('keeps all controls on narrow tall terminals and uses one row when wide', () => {
    const narrow = layoutHints(HINTS, 30, 12);
    expect(narrow.dropped).toBe(0);
    expect(narrow.rows.length).toBeGreaterThan(1);
    expect(narrow.rows.flat()).toEqual(HINTS);
    for (const row of narrow.rows) {
      expect(
        Bun.stringWidth(row.map((hint) => `[${hint.key}] ${hint.label}`).join(' · ')),
      ).toBeLessThanOrEqual(30);
    }
    expect(layoutHints(HINTS, 200, 12).rows).toEqual([HINTS]);
  });

  test('stacks whole buttons and limits rows only when height is scarce', () => {
    const stacked = layoutHints(HINTS, 18, 20);
    expect(stacked.rows.every((row) => row.length === 1)).toBe(true);
    expect(stacked.dropped).toBe(0);
    const short = layoutHints(HINTS, 30, 2);
    expect(short.rows).toHaveLength(2);
    expect(short.dropped).toBeGreaterThan(0);
    expect(short.rows.flat().length + short.dropped).toBe(HINTS.length);
  });

  test('counts terminal cells for Unicode labels when packing buttons', () => {
    expect(hintWidth({ key: 'x', label: '界界' })).toBe(8);
    const hints = [
      { key: 'x', label: '界界' },
      { key: 'y', label: 'ok' },
    ];
    expect(layoutHints(hints, 15, 3).rows).toHaveLength(2);
  });
});

/** What a row of hints actually draws, so the fit can be checked against it. */
const drawn = (hints: Hint[]) => hints.map((hint) => `[${hint.key}] ${hint.label}`).join(' · ');

describe('hintWidth', () => {
  test('counts the brackets and the space the row draws', () => {
    expect(hintWidth({ key: 'r', label: 'rename' })).toBe(drawn([HINTS[2] as Hint]).length);
    expect(hintWidth({ key: 'Enter', label: 'edit steps' })).toBe(drawn([HINTS[1] as Hint]).length);
  });
});

describe('fitHints', () => {
  test('keeps every hint when the row has the cells for them', () => {
    const { shown, dropped } = fitHints(HINTS, drawn(HINTS).length);
    expect(dropped).toBe(0);
    expect(shown).toHaveLength(HINTS.length);
  });

  test('never draws past the width it was given', () => {
    // Every width from too narrow for one hint to wider than the whole row —
    // a hint drawn past the edge is a button that cannot be clicked, and one
    // that wraps is a second row every list budget was priced without.
    const overruns: { columns: number; width: number }[] = [];
    for (let columns = 0; columns <= drawn(HINTS).length + 4; columns += 1) {
      const { shown, dropped } = fitHints(HINTS, columns);
      // One hint is kept even where nothing fits: at that width the row is
      // past saving, and a clipped hint beats a bare ellipsis.
      if (shown.length <= 1) continue;
      const width = drawn(shown).length + (dropped > 0 ? 2 : 0);
      if (width > columns) overruns.push({ columns, width });
    }
    expect(overruns).toEqual([]);
  });

  test('drops whole hints from the end, in the order it was given', () => {
    const { shown, dropped } = fitHints(HINTS, drawn(HINTS.slice(0, 4)).length);
    expect(shown.map((hint) => hint.key)).toEqual(['↑/↓', 'Enter', 'r']);
    expect(dropped).toBe(5);
  });

  test('gives up a hint that fits to make room for the ellipsis', () => {
    // Exactly the first four and not a cell more: the fourth has to go, or the
    // "…" saying the rest were dropped has nowhere to be drawn.
    const columns = drawn(HINTS.slice(0, 4)).length;
    const { shown } = fitHints(HINTS, columns);
    expect(shown).toHaveLength(3);
    expect(drawn(shown).length + 2).toBeLessThanOrEqual(columns);
  });

  test('a row too narrow for anything still shows one hint', () => {
    //? Down to zero columns. The row is `overflow: hidden`, so a hint wider than
    //? the row is clipped rather than wrapped — and a clipped `[↑/↓] mac` still
    //? names the key, where a lone "…" names nothing. (The first version of this
    //? kept nothing here, which contradicted both its own name and the comment
    //? in the code it was testing.)
    const none = fitHints(HINTS, 0);
    expect(none.shown).toHaveLength(1);
    expect(none.dropped).toBe(HINTS.length - 1);

    const one = fitHints(HINTS, hintWidth(HINTS[0] as Hint));
    expect(one.shown).toHaveLength(1);
    expect(one.dropped).toBe(HINTS.length - 1);
  });

  test('an empty list stays empty rather than inventing a hint', () => {
    expect(fitHints([], 80)).toEqual({ shown: [], dropped: 0 });
  });
});

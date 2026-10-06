import { describe, expect, test } from 'bun:test';

import {
  ascending,
  chromeCost,
  contentRows,
  createTheme,
  hiddenLabels,
  pickByTier,
  resolveDisplay,
  tierFor,
} from './index';

const TIERS = { short: 0, compact: 20, regular: 30, tall: 40 };
const ORDER = ascending(TIERS);

describe('tiers', () => {
  test('orders smallest first, whatever order the table was written in', () => {
    expect(ascending({ tall: 40, short: 0, regular: 30 })).toEqual(['short', 'regular', 'tall']);
  });

  test('a measurement lands in the largest tier it clears', () => {
    expect(tierFor(TIERS, ORDER, 10)).toBe('short');
    expect(tierFor(TIERS, ORDER, 30)).toBe('regular');
    expect(tierFor(TIERS, ORDER, 999)).toBe('tall');
  });

  test('a tier the map skips keeps what the tier below it said', () => {
    const values = { short: 'a', regular: 'b' };
    expect(pickByTier(ORDER, 'compact', values)).toBe('a');
    expect(pickByTier(ORDER, 'regular', values)).toBe('b');
    expect(pickByTier(ORDER, 'tall', values)).toBe('b');
  });
});

describe('chrome', () => {
  const table = { bar: { bordered: 4, plain: 2 }, panel: 6 };

  test('a part that sheds its frame costs less once it has', () => {
    expect(chromeCost(table, 'bar', true)).toBe(4);
    expect(chromeCost(table, 'bar', false)).toBe(2);
  });

  test('a flat price is the same either way', () => {
    expect(chromeCost(table, 'panel', false)).toBe(6);
  });

  test('an unknown part costs nothing rather than NaN', () => {
    expect(chromeCost(table, 'nope', true)).toBe(0);
  });

  test('content rows are what is left after the listed parts', () => {
    expect(contentRows(table, 40, ['bar', 'panel'])).toBe(30);
    expect(contentRows(table, 40, ['bar', 'panel'], { bordered: false })).toBe(32);
  });

  test('the floor holds when the chrome alone does not fit', () => {
    expect(contentRows(table, 4, ['bar', 'panel'], { min: 3 })).toBe(3);
  });
});

describe('display rules', () => {
  const table = {
    frames: { label: 'frames', minRows: 30 },
    detail: { label: 'detail', minColumns: 100, requires: 'frames' },
  };

  test('an element shows only when it has the room it asks for', () => {
    expect(resolveDisplay(table, 120, 40).frames).toBe(true);
    expect(resolveDisplay(table, 120, 20).frames).toBe(false);
  });

  test('an element is hidden when what it requires is hidden', () => {
    expect(resolveDisplay(table, 120, 20).detail).toBe(false);
  });

  test('a rule that requires its way back to itself shows rather than hangs', () => {
    const cyclic = { a: { label: 'a', requires: 'b' }, b: { label: 'b', requires: 'a' } };
    expect(resolveDisplay(cyclic, 80, 24)).toEqual({ a: true, b: true });
  });

  test('names what a size is costing, without the knock-on effects', () => {
    //? `detail` is out only because `frames` is, which is not news.
    expect(hiddenLabels(table, resolveDisplay(table, 120, 20))).toEqual(['frames']);
  });
});

describe('createTheme', () => {
  test('an app that moves one breakpoint keeps the rest', () => {
    const theme = createTheme({ breakpoints: { columns: { narrow: 0, wide: 96 } } });
    expect(theme.breakpoints.columns.wide).toBe(96);
    expect(theme.breakpoints.rows.regular).toBeGreaterThan(0);
  });

  test('barBorders follows the app-s own row threshold, not the stock one', () => {
    const theme = createTheme({ breakpoints: { rows: { short: 0, regular: 28 } } });
    expect(theme.display.barBorders?.minRows).toBe(28);
  });

  test('an app that adds a display element keeps barBorders', () => {
    const theme = createTheme({ display: { mine: { label: 'mine', minRows: 50 } } });
    expect(Object.keys(theme.display).sort()).toEqual(['barBorders', 'mine']);
  });

  test('an app that adds a chrome part keeps the stock ones', () => {
    const theme = createTheme({ chrome: { mine: 3 } });
    expect(theme.chrome.mine).toBe(3);
    expect(theme.chrome.appShell).toBeDefined();
  });

  test('sizes merge one level deep, so app.minWidth alone is enough', () => {
    const theme = createTheme({ sizes: { app: { minWidth: 64 } } });
    expect(theme.sizes.app.minWidth).toBe(64);
    expect(theme.sizes.app.minHeight).toBeGreaterThan(0);
  });
});

describe('display order', () => {
  test('an app keeps its own shed order, which hiddenLabels reports in', () => {
    //? The order is the argument: cheapest meaning goes first. A stock element
    //? merged in ahead of it would silently rewrite that argument.
    const theme = createTheme({
      display: {
        captions: { label: 'captions', minRows: 45 },
        barBorders: { label: 'bar frames', minRows: 41 },
        rules: { label: 'rules', minRows: 35 },
      },
    });

    expect(Object.keys(theme.display)).toEqual(['captions', 'barBorders', 'rules']);
    expect(hiddenLabels(theme.display, resolveDisplay(theme.display, 200, 40))).toEqual([
      'captions',
      'bar frames',
    ]);
  });

  test('an element the app never mentions is appended, not prepended', () => {
    const theme = createTheme({ display: { mine: { label: 'mine', minRows: 50 } } });
    expect(Object.keys(theme.display)).toEqual(['mine', 'barBorders']);
  });
});

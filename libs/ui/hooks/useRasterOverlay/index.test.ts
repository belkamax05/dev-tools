import { describe, expect, test } from 'bun:test';
import type { DOMElement } from 'ink';

import { isFullyVisible } from '.';

/** Just enough of an Ink node for `measureElement`: a Yoga box, a style, a parent. */
const node = (
  box: { left: number; top: number; width: number; height: number },
  style: Record<string, unknown> = {},
  parentNode?: DOMElement,
) =>
  ({
    style,
    parentNode,
    yogaNode: {
      getComputedLeft: () => box.left,
      getComputedTop: () => box.top,
      getComputedWidth: () => box.width,
      getComputedHeight: () => box.height,
    },
  }) as unknown as DOMElement;

const screen = { columns: 100, rows: 30 };

describe('isFullyVisible', () => {
  //? A framed, clipping panel at (10, 5), 40 × 12: its inside is rows 6–15
  const panel = node({ left: 10, top: 5, width: 40, height: 12 }, { overflow: 'hidden', borderStyle: 'round' });
  const image = node({ left: 2, top: 2, width: 20, height: 6 }, {}, panel);

  test('an image inside its panel is drawn', () => {
    expect(isFullyVisible(image, { x: 12, y: 7, width: 20, height: 6 }, screen)).toBe(true);
  });

  test('one reaching past the bottom of a clipping panel is not', () => {
    expect(isFullyVisible(image, { x: 12, y: 12, width: 20, height: 6 }, screen)).toBe(false);
  });

  test('the border is not room for it', () => {
    //? Rows 6–16 would touch the bottom border on row 16
    expect(isFullyVisible(image, { x: 12, y: 6, width: 20, height: 11 }, screen)).toBe(false);
  });

  test('past the last row of the terminal is never drawn, clipping or not', () => {
    const loose = node({ left: 0, top: 25, width: 20, height: 8 });
    expect(isFullyVisible(loose, { x: 0, y: 25, width: 20, height: 8 }, screen)).toBe(false);
  });

  test('a box that does not clip does not limit it', () => {
    const open = node({ left: 0, top: 0, width: 5, height: 2 });
    const inside = node({ left: 0, top: 0, width: 20, height: 8 }, {}, open);
    expect(isFullyVisible(inside, { x: 0, y: 0, width: 20, height: 8 }, screen)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';

import { firstSelectable, moveInList, nextSelectable, type PickItem, packRows } from './index';

/** A catalogue-shaped list: two groups behind headers. */
const list = (): PickItem<number>[] => [
  { id: 'h1', label: 'Letters', isHeader: true },
  ...['A', 'B', 'C', 'D', 'E'].map((label) => ({ id: label, label })),
  { id: 'h2', label: 'Digits', isHeader: true },
  ...['1', '2', '3'].map((label) => ({ id: label, label })),
];

describe('nextSelectable', () => {
  test('skips headers and disabled options', () => {
    const items = list();
    // Index 0 is a header, so the first option is 1.
    expect(firstSelectable(items)).toBe(1);
    // Index 5 is "E"; 6 is the Digits header; 7 is "1".
    expect(nextSelectable(items, 5, 1)).toBe(7);
    expect(nextSelectable(items, 7, -1)).toBe(5);
  });

  test('stays put rather than wrapping onto a heading', () => {
    const items = list();
    expect(nextSelectable(items, 1, -1)).toBe(1);
    expect(nextSelectable(items, items.length - 1, 1)).toBe(items.length - 1);
  });

  test('passes over a disabled option to reach a usable one', () => {
    // A category may disable options while some mode is selected; a cursor that
    // parks on one of them makes Enter do nothing.
    const items: PickItem<number>[] = [
      { id: 'a', label: '1' },
      { id: 'b', label: '2', disabled: true },
      { id: 'c', label: '3' },
    ];
    expect(nextSelectable(items, 0, 1)).toBe(2);
  });
});

describe('packRows', () => {
  test('one per row in a single column', () => {
    expect(packRows(list(), 1)).toEqual([[0], [1], [2], [3], [4], [5], [6], [7], [8], [9]]);
  });

  test('a header always takes a row to itself', () => {
    const rows = packRows(list(), 3);
    expect(rows[0]).toEqual([0]);
    expect(rows[1]).toEqual([1, 2, 3]);
  });

  test('groups never run together on one row', () => {
    // The last row of group one is short rather than being topped up from group
    // two, which is what keeps the groups readable as groups.
    expect(packRows(list(), 3)).toEqual([[0], [1, 2, 3], [4, 5], [6], [7, 8, 9]]);
  });
});

describe('moveInList', () => {
  test('in one column, up and down step one option', () => {
    const items = list();
    expect(moveInList(items, 1, 1, 'down')).toBe(2);
    expect(moveInList(items, 1, 2, 'up')).toBe(1);
  });

  test('in a grid, left and right step one and up and down move a row', () => {
    // Three columns: [A B C] [D E] then the header, then [1 2 3].
    const items = list();
    expect(moveInList(items, 3, 1, 'right')).toBe(2); // A -> B
    expect(moveInList(items, 3, 1, 'down')).toBe(4); // A -> D
    expect(moveInList(items, 3, 4, 'up')).toBe(1); // D -> A
  });

  test('a short row takes the nearest column it has', () => {
    // Row two is [D E] with no third column; moving down from C lands on E
    // rather than nowhere.
    expect(moveInList(list(), 3, 3, 'down')).toBe(5); // C -> E
  });

  test('moves down through a header into the next group', () => {
    // The header occupies a whole row of its own, and is not somewhere the
    // cursor may rest, so it is stepped over rather than landed on.
    expect(moveInList(list(), 3, 4, 'down')).toBe(7); // D -> 1
  });

  test('groups start their own row rather than packing onto the last one', () => {
    // "1" must be the first cell of a row, not the third cell of the row "D E"
    // ended on — otherwise two groups run together and the headers stop
    // meaning anything.
    expect(moveInList(list(), 3, 7, 'up')).toBe(4); // 1 -> D, same column
  });

  test('stays put at the edges', () => {
    const items = list();
    expect(moveInList(items, 3, 1, 'up')).toBe(1);
    expect(moveInList(items, 3, 9, 'down')).toBe(9);
  });
});

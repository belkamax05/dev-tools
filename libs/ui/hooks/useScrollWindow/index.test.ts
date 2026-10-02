import { expect, test } from 'bun:test';
import { followSelection, windowEnd, windowStart } from './index';

test('a one-line heading and two 13-line card rows fit in 27 lines', () => {
  expect(windowEnd([1, 13, 13, 13], 0, 27)).toBe(3);
});

test('fills the budget across several group headings without clipping the next card', () => {
  expect(windowEnd([1, 13, 1, 13, 13], 0, 28)).toBe(4);
  expect(windowEnd([1, 13, 1, 13, 13], 0, 27)).toBe(3);
});

test('scrolling down keeps the selected card fully visible and fills the window', () => {
  const heights = [1, 13, 13, 1, 13, 13];
  const start = followSelection(heights, 27, 0, 4);
  expect(start).toBe(2);
  expect(windowEnd(heights, start, 27)).toBe(5);
  expect(followSelection(heights, 27, start, 1)).toBe(1);
});

test('fills the last window and clamps an old offset after filtering or resizing', () => {
  const heights = [1, 13, 1, 13, 13];
  expect(windowStart(heights, heights.length, 27)).toBe(2);
  expect(followSelection(heights, 27, 99, 4)).toBe(2);
  expect(followSelection(heights, 41, 2, 4)).toBe(0);
});

test('preserves one-line list windowing and handles empty lists', () => {
  expect(windowEnd([1, 1, 1, 1, 1], 0, 3)).toBe(3);
  expect(followSelection([1, 1, 1, 1, 1], 3, 0, 3)).toBe(1);
  expect(followSelection([], 3, 7, 0)).toBe(0);
  expect(windowEnd([], 0, 3)).toBe(0);
});

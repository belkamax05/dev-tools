import { describe, expect, test } from 'bun:test';

import { borderRow, busRow, layoutGraph, levelsOf } from '.';

const PIPELINE = [
  { id: 'push' },
  { id: 'nginx', after: ['push'] },
  { id: 'nodejs', after: ['push'] },
  { id: 'deploy', after: ['nginx', 'nodejs'] },
  { id: 'propagate', after: ['deploy'] },
];

describe('levelsOf', () => {
  test('steps waiting on the same step share a level', () => {
    expect([...levelsOf(PIPELINE)]).toEqual([
      ['push', 0],
      ['nginx', 1],
      ['nodejs', 1],
      ['deploy', 2],
      ['propagate', 3],
    ]);
  });
});

describe('layoutGraph', () => {
  test('parallel steps split the width, single ones take all of it', () => {
    const levels = layoutGraph(PIPELINE, 21);
    expect(levels.map((level) => level.nodes.map((node) => node.id))).toEqual([
      ['push'],
      ['nginx', 'nodejs'],
      ['deploy'],
      ['propagate'],
    ]);
    expect(levels[1]?.nodes.map(({ x, width, center }) => [x, width, center])).toEqual([
      [0, 10, 5],
      [11, 10, 16],
    ]);
    expect(levels[0]?.nodes[0]).toMatchObject({ x: 0, width: 21, center: 10 });
  });
});

describe('busRow', () => {
  test('fan-out: one box above, two below', () => {
    expect(busRow([10], [5, 16], 21)).toBe('     ┌────┴─────┐    ');
  });
  test('fan-in: two above, one below', () => {
    expect(busRow([5, 16], [10], 21)).toBe('     └────┬─────┘    ');
  });
  test('straight down', () => {
    expect(busRow([10], [10], 21)).toBe('          │          ');
  });
  test('a parent and a child on one column join the bus from both sides', () => {
    expect(busRow([2, 6], [2], 9)).toBe('  ├───┘  ');
  });
});

describe('borderRow', () => {
  test('puts the tee where the connector meets the box', () => {
    expect(borderRow(9, ['╭', '╮'], '─', '┴', 4)).toBe('╭───┴───╮');
    expect(borderRow(9, ['╰', '╯'], '─', undefined, 4)).toBe('╰───────╯');
  });
});

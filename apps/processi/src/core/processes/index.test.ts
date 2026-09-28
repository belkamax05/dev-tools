import { describe, expect, test } from 'bun:test';

import { isInside, matchesQuery, type ProcessRow, sortProcesses, toTree } from './index';

const row = (pid: number, ppid: number, cpu = 0, name = `p${pid}`): ProcessRow => ({
  pid,
  ppid,
  uid: 1000,
  user: 'me',
  cpu,
  mem: 0,
  rss: pid,
  elapsed: '00:01',
  elapsedSeconds: pid,
  state: 'S',
  command: `/bin/${name} --flag`,
  name,
  depth: 0,
});

describe('toTree', () => {
  test('nests visible children under their parent, siblings in sort order', () => {
    const tree = toTree([row(1, 0), row(2, 1, 5), row(3, 1, 50), row(4, 3)], 'cpu');
    expect(tree.map((entry) => [entry.pid, entry.depth])).toEqual([
      [1, 0],
      [3, 1],
      [4, 2],
      [2, 1],
    ]);
  });

  test('a process whose parent is filtered out becomes a root', () => {
    expect(toTree([row(9, 8)], 'pid').map((entry) => entry.depth)).toEqual([0]);
  });
});

describe('sortProcesses', () => {
  test('cpu and memory heaviest first, pid and name ascending', () => {
    const list = [row(2, 0, 1, 'b'), row(1, 0, 9, 'c'), row(3, 0, 5, 'a')];
    expect(sortProcesses(list, 'cpu').map((entry) => entry.pid)).toEqual([1, 3, 2]);
    expect(sortProcesses(list, 'pid').map((entry) => entry.pid)).toEqual([1, 2, 3]);
    expect(sortProcesses(list, 'name').map((entry) => entry.name)).toEqual(['a', 'b', 'c']);
  });
});

describe('matchesQuery / isInside', () => {
  test('matches an exact pid, or text in name, command or user', () => {
    expect(matchesQuery(row(42, 1), '42')).toBe(true);
    expect(matchesQuery(row(420, 1, 0, 'x'), '42')).toBe(false);
    expect(matchesQuery(row(1, 0, 0, 'node'), 'NODE')).toBe(true);
    expect(matchesQuery(row(1, 0), '--flag')).toBe(true);
  });

  test('a folder contains itself and what is below it, not its name-prefixed siblings', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bc', '/a/b')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';

import { layoutCompareTable, MAX_VERSION_COLUMN } from './index';

const barColumns = (line: string) => [...line].flatMap((char, at) => (char === '│' ? [at] : []));

describe('layoutCompareTable', () => {
  const rows = [
    { name: 'react', versions: ['18.2.0', '19.1.0-canary.3', '—'] },
    { name: '@tanstack/react-query', versions: ['5.1.0', '5.90.21', '5.2.0'] },
    { name: 'zod', versions: ['4.0.0', '—', '3.23.8'] },
  ];

  test('every bar is in the same column on the header and on every row', () => {
    const table = layoutCompareTable(['here', '../web', '../../far/away/api'], rows, 80);
    const expected = barColumns(table.header);
    expect(expected).toHaveLength(3);
    for (const line of table.lines) expect(barColumns(line)).toEqual(expected);
  });

  test('a column is as wide as its widest entry, capped, and cut with an ellipsis', () => {
    const table = layoutCompareTable(
      ['here'],
      [{ name: 'nitro', versions: ['3.0.1-20260420-010726-8c3f16b2'] }],
      80,
    );
    const cell = table.lines[0]?.split(' │ ')[1] ?? '';
    expect(cell).toHaveLength(MAX_VERSION_COLUMN);
    expect(cell.endsWith('…')).toBe(true);
  });

  test('the name gives way to fit the width; a long path header keeps its end', () => {
    const table = layoutCompareTable(['here', '../web', '../../far/away/api'], rows, 50);
    for (const line of [table.header, ...table.lines]) expect(line.length).toBeLessThanOrEqual(50);
    expect(table.lines[1]?.startsWith('@tanstack')).toBe(true);
    expect(table.header).toContain('…');
    expect(table.header.trimEnd().endsWith('away/api')).toBe(true);
  });
});

import type { CompareRow } from '../../../core/compare';
import type { Dependency } from '../../../core/manifest';
import { cellStanding, summarizeRow } from './index';

const dep = (installed: string): Dependency => ({
  name: 'react',
  range: `^${installed}`,
  type: 'dependencies',
  local: false,
  installed,
});

describe('summarizeRow / cellStanding', () => {
  const labels = ['here', '../web', '../api'];

  test('names who is behind, where the newest is, and who lacks it', () => {
    const row: CompareRow = {
      name: 'react',
      cells: [dep('18.2.0'), dep('18.3.1'), undefined],
      differs: true,
      highest: '18.3.1',
    };
    expect(labels.map((_, at) => cellStanding(row, at))).toEqual(['behind', 'newest', 'missing']);
    expect(summarizeRow(row, labels)).toBe(
      'Behind the newest 18.3.1 (../web): here · not a dependency in ../api',
    );
  });

  test('says so when every folder agrees', () => {
    const row: CompareRow = {
      name: 'zod',
      cells: [dep('4.0.0'), dep('4.0.0'), dep('4.0.0')],
      differs: false,
      highest: '4.0.0',
    };
    expect(summarizeRow(row, labels)).toBe('Same version everywhere: 4.0.0');
    expect(cellStanding(row, 1)).toBe('same');
  });

  test('no ★ when the row differs only because a folder lacks the package', () => {
    const row: CompareRow = {
      name: 'ink',
      cells: [dep('7.1.1'), dep('7.1.1'), undefined],
      differs: true,
      highest: '7.1.1',
    };
    expect(labels.map((_, at) => cellStanding(row, at))).toEqual(['same', 'same', 'missing']);
    expect(summarizeRow(row, labels)).toBe(
      'On 7.1.1 wherever it is declared · not a dependency in ../api',
    );
  });
});

import { describe, expect, test } from 'bun:test';

import { layoutCompareTable } from './index';

const barColumns = (line: string) => [...line].flatMap((char, at) => (char === '│' ? [at] : []));

/** The cells of a laid-out line, as drawn — padding included. */
const cells = (line: string) => line.split(' │ ');

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

  test('a version column is exactly as wide as its longest version, however long', () => {
    const table = layoutCompareTable(
      ['here'],
      [
        { name: 'nitro', versions: ['3.0.1-20260420-010726-8c3f16b2'] },
        { name: 'zod', versions: ['4.0.0'] },
      ],
      80,
    );
    expect(cells(table.lines[0] ?? '')[1]).toBe('3.0.1-20260420-010726-8c3f16b2');
    expect(cells(table.lines[1] ?? '')[1]).toBe('4.0.0'.padEnd(30));
  });

  test('the name is cut before any version is, and the table fits the width', () => {
    const table = layoutCompareTable(['here', '../web', '../../far/away/api'], rows, 48);
    for (const line of [table.header, ...table.lines]) expect(line.length).toBeLessThanOrEqual(48);
    const [name, here, web, far] = cells(table.lines[1] ?? '');
    expect(name?.endsWith('…')).toBe(true);
    expect([here?.trimEnd(), web?.trimEnd(), far?.trimEnd()]).toEqual([
      '5.1.0',
      '5.90.21',
      '5.2.0',
    ]);
    expect(cells(table.lines[0] ?? '')[2]).toBe('19.1.0-canary.3');
  });

  test('headers take only room the names leave, cut from the start before that', () => {
    const headers = ['here', '../../far/away/api'];
    const twoColumns = rows.map((row) => ({ ...row, versions: row.versions.slice(0, 2) }));
    const tight = layoutCompareTable(headers, twoColumns, 50);
    expect(cells(tight.header)[2]?.startsWith('…')).toBe(true);
    expect(tight.lines[1]?.startsWith('@tanstack/react-query ')).toBe(true);

    const roomy = layoutCompareTable(headers, twoColumns, 80);
    expect(cells(roomy.header)[2]).toBe('../../far/away/api');
  });

  test('sized to the visible rows only, so scrolling relays the columns out', () => {
    const long = [
      { name: 'zod', versions: ['4.0.0'] },
      { name: 'ink', versions: ['7.1.1'] },
      { name: 'nitro', versions: ['3.0.1-20260420-010726-8c3f16b2'] },
    ];
    const top = layoutCompareTable(['here'], long, 80, { from: 0, to: 2 });
    expect(cells(top.lines[0] ?? '')[1]).toBe('4.0.0');

    const bottom = layoutCompareTable(['here'], long, 80, { from: 1, to: 3 });
    expect(cells(bottom.lines[2] ?? '')[1]).toBe('3.0.1-20260420-010726-8c3f16b2');
    expect(cells(bottom.lines[1] ?? '')[1]).toBe('7.1.1'.padEnd(30));
  });

  test('only when the versions alone overflow are they cut too, widest first', () => {
    const table = layoutCompareTable(['here', '../web', '../../far/away/api'], rows, 30);
    for (const line of [table.header, ...table.lines]) expect(line.length).toBeLessThanOrEqual(30);
    expect(cells(table.lines[0] ?? '')[0]).toBe('react  ');
    expect(cells(table.lines[0] ?? '')[2]?.endsWith('…')).toBe(true);
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

import { describe, expect, test } from 'bun:test';
import type PickerItem from '../../../types/PickerItem';
import filterPickerItems from '.';

const items: PickerItem[] = [
  { value: 'deploy-app', label: 'deploy-app', description: 'Ship to production' },
  { value: 'build-app', label: 'build-app', description: 'Compile the bundle' },
  { value: 'test-runner', label: 'test-runner' },
  { value: 'secret', label: 'secret', description: 'internal only', hidden: true },
];

describe('filterPickerItems', () => {
  test('keeps every visible row when nothing is typed', () => {
    expect(filterPickerItems(items, '').map((item) => item.value)).toEqual([
      'deploy-app',
      'build-app',
      'test-runner',
    ]);
  });

  test('matches a label regardless of the casing typed', () => {
    expect(filterPickerItems(items, 'DePloY').map((item) => item.value)).toEqual(['deploy-app']);
  });

  test('matches on the description, so a row is findable by what it does', () => {
    expect(filterPickerItems(items, 'production').map((item) => item.value)).toEqual([
      'deploy-app',
    ]);
  });

  test('matches partway into a label, not just at its start', () => {
    expect(filterPickerItems(items, 'app').map((item) => item.value)).toEqual([
      'deploy-app',
      'build-app',
    ]);
  });

  test('a hidden row stays hidden even when the query names it', () => {
    expect(filterPickerItems(items, 'secret')).toEqual([]);
  });

  test('a row without a description is not treated as matching everything', () => {
    expect(filterPickerItems(items, 'compile').map((item) => item.value)).toEqual(['build-app']);
  });

  test('an unmatched query yields nothing rather than falling back to the full list', () => {
    expect(filterPickerItems(items, 'zzzz')).toEqual([]);
  });
});

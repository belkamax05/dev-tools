import { describe, expect, test } from 'bun:test';
import type PickerItem from '../../../types/PickerItem';
import resolvePickerChildren from '.';

const child: PickerItem = { value: 'install', label: 'install' };

describe('resolvePickerChildren', () => {
  test('a row without children reads as a leaf rather than an empty group', () => {
    expect(resolvePickerChildren({ value: 'hash', label: 'hash' })).toBeUndefined();
  });

  test('returns the children a group lists directly', () => {
    expect(resolvePickerChildren({ value: 'subrepo', label: 'subrepo', children: [child] })).toEqual(
      [child],
    );
  });

  test('calls a thunk only when the group is opened', () => {
    let calls = 0;
    const item: PickerItem = {
      value: 'subrepo',
      label: 'subrepo',
      children: () => {
        calls += 1;
        return [child];
      },
    };
    expect(calls).toBe(0);
    expect(resolvePickerChildren(item)).toEqual([child]);
    expect(calls).toBe(1);
  });

  test('an empty group stays a group, so opening it shows an empty level', () => {
    expect(resolvePickerChildren({ value: 'empty', label: 'empty', children: [] })).toEqual([]);
  });
});

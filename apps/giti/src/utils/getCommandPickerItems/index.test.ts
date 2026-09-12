import { describe, expect, test } from 'bun:test';
import type { CommandEntry } from '../../types/CommandEntry';
import getCommandPickerItems from '.';

const entry = (name: string, description?: string): CommandEntry => ({
  name,
  key: name.slice(name.lastIndexOf('/') + 1),
  path: `/commands/${name}.ts`,
  meta: description ? { name, description } : undefined,
});

describe('getCommandPickerItems', () => {
  test('a top-level command becomes a row the CLI can dispatch by value', () => {
    const [item] = getCommandPickerItems([entry('status', 'Show status')]);
    expect(item).toMatchObject({ value: 'status', label: 'status', description: 'Show status' });
    expect(item?.children).toBeUndefined();
  });

  test('a nested command is folded into a folder labelled by its first segment', () => {
    const items = getCommandPickerItems([entry('subrepo/hi'), entry('subrepo/install')]);
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('subrepo');
  });

  test('opening a folder yields rows whose value is still the full command name', () => {
    const [folder] = getCommandPickerItems([entry('subrepo/hi'), entry('subrepo/install')]);
    const children = typeof folder?.children === 'function' ? folder.children() : folder?.children;
    expect(children?.map((child) => [child.label, child.value])).toEqual([
      ['hi', 'subrepo/hi'],
      ['install', 'subrepo/install'],
    ]);
  });

  test('a folder counts what it holds so the preview has something to say', () => {
    const [folder] = getCommandPickerItems([entry('subrepo/hi'), entry('subrepo/install')]);
    expect(folder?.description).toBe('2 commands');
    const [single] = getCommandPickerItems([entry('subrepo/hi')]);
    expect(single?.description).toBe('1 command');
  });

  test('a folder never collides with a command sharing its name', () => {
    const items = getCommandPickerItems([entry('subrepo'), entry('subrepo/hi')]);
    const values = items.map((item) => item.value);
    expect(new Set(values).size).toBe(values.length);
  });

  test('folders and commands are listed together in alphabetical order', () => {
    const items = getCommandPickerItems([
      entry('wip'),
      entry('amend'),
      entry('subrepo/hi'),
      entry('status'),
    ]);
    expect(items.map((item) => item.label)).toEqual(['amend', 'status', 'subrepo', 'wip']);
  });

  test('nests further than one level without folders shadowing each other', () => {
    const [outer] = getCommandPickerItems([entry('a/b/c')]);
    const middle = typeof outer?.children === 'function' ? outer.children() : outer?.children;
    expect(outer?.value).toBe('a/');
    expect(middle?.[0]?.value).toBe('a/b/');
    const leaf = middle?.[0]?.children;
    const leaves = typeof leaf === 'function' ? leaf() : leaf;
    expect(leaves?.[0]?.value).toBe('a/b/c');
  });

  test('the description a command omits is left unset rather than invented', () => {
    const [item] = getCommandPickerItems([entry('subrepo/hi')]);
    const children = typeof item?.children === 'function' ? item.children() : item?.children;
    expect(children?.[0]?.description).toBeUndefined();
  });
});

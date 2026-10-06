import { describe, expect, test } from 'bun:test';
import selectChanges from '.';

//? One line per case: staged-only edit, unstaged-only edit, edit on both sides, a staged add,
//? an unstaged delete, a staged rename, an untracked file and a conflict
const STATUS = [
  'M  staged.ts',
  ' M unstaged.ts',
  'MM both.ts',
  'A  added.ts',
  ' D gone.ts',
  'R  old.ts -> new.ts',
  '?? fresh.ts',
  'UU clash.ts',
].join('\n');

describe('selectChanges', () => {
  test('takes every unstaged change, untracked included, when no kind is named', () => {
    expect(selectChanges(STATUS, 'unstaged')).toEqual([
      'unstaged.ts',
      'both.ts',
      'gone.ts',
      'fresh.ts',
    ]);
  });

  test('reads the index column for the staged side', () => {
    expect(selectChanges(STATUS, 'staged')).toEqual([
      'staged.ts',
      'both.ts',
      'added.ts',
      'new.ts',
      'old.ts',
    ]);
  });

  test('narrows to the kinds asked for', () => {
    expect(selectChanges(STATUS, 'unstaged', ['deleted', 'untracked'])).toEqual([
      'gone.ts',
      'fresh.ts',
    ]);
    expect(selectChanges(STATUS, 'staged', ['renamed'])).toEqual(['new.ts', 'old.ts']);
  });

  test('never offers a conflicted file for a bulk operation', () => {
    expect(selectChanges(STATUS, 'unstaged')).not.toContain('clash.ts');
    expect(selectChanges(STATUS, 'staged')).not.toContain('clash.ts');
  });
});

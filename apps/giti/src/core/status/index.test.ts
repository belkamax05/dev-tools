import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import makeRepo from '../testRepo';
import { discard, getChanges, parseStatus, stage, stageAll, undoDiscard, unstage } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('status', () => {
  test('parses renames and conflicts from -z output', () => {
    const changes = parseStatus('R  new.txt\0old.txt\0UU both.txt\0?? loose.txt\0 M edited.txt\0');
    expect(
      changes.map((c) => [c.path, c.origPath, c.staged, c.unstaged, c.conflicted, c.untracked]),
    ).toEqual([
      ['new.txt', 'old.txt', true, false, false, false],
      ['both.txt', undefined, false, false, true, false],
      ['loose.txt', undefined, false, true, false, true],
      ['edited.txt', undefined, false, true, false, false],
    ]);
  });

  test('stages and unstages, including a path with spaces', async () => {
    repo = makeRepo();
    repo.write('a.txt', 'changed\n');
    repo.write('with space.txt', 'x');
    expect((await stage(repo.root, ['a.txt', 'with space.txt'])).ok).toBe(true);
    expect((await getChanges(repo.root)).every((c) => c.staged)).toBe(true);
    expect((await unstage(repo.root, ['with space.txt'])).ok).toBe(true);
    expect((await getChanges(repo.root)).find((c) => c.path === 'with space.txt')?.untracked).toBe(
      true,
    );
    await stageAll(repo.root);
    expect((await getChanges(repo.root)).every((c) => c.staged)).toBe(true);
  });

  test('discard keeps staged changes, and undo brings the rest back', async () => {
    repo = makeRepo();
    repo.write('a.txt', 'staged\n');
    await stage(repo.root, ['a.txt']);
    repo.write('a.txt', 'staged, then more\n');
    repo.write('new/loose.txt', 'loose');
    const changes = await getChanges(repo.root);
    const result = await discard(repo.root, changes);
    expect(result.ok).toBe(true);
    expect(repo.read('a.txt')).toBe('staged\n');
    expect(existsSync(join(repo.root, 'new/loose.txt'))).toBe(false);
    expect((await undoDiscard(repo.root, result.undo!)).ok).toBe(true);
    expect(repo.read('a.txt')).toBe('staged, then more\n');
    expect(repo.read('new/loose.txt')).toBe('loose');
  });
});

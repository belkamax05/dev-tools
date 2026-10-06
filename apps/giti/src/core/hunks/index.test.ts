import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { discardHunk, getDiff, parseDiff, reapplyPatch, stageHunk, unstageHunk } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const twoHunks = 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n';

describe('hunks', () => {
  test('splits a diff into its hunks', async () => {
    repo = makeRepo();
    repo.write('a.txt', twoHunks);
    const diff = parseDiff(await getDiff(repo.root, 'a.txt', 'unstaged'));
    expect(diff.hunks).toHaveLength(2);
    expect(diff.head[0]).toStartWith('diff --git');
  });

  test('stages one hunk, then unstages it', async () => {
    repo = makeRepo();
    repo.write('a.txt', twoHunks);
    const unstaged = parseDiff(await getDiff(repo.root, 'a.txt', 'unstaged'));
    expect((await stageHunk(repo.root, unstaged, 1)).ok).toBe(true);
    const staged = parseDiff(await getDiff(repo.root, 'a.txt', 'staged'));
    expect(staged.hunks).toHaveLength(1);
    expect(staged.hunks[0]?.lines.join('\n')).toContain('+TEN');
    expect(parseDiff(await getDiff(repo.root, 'a.txt', 'unstaged')).hunks).toHaveLength(1);
    expect((await unstageHunk(repo.root, staged, 0)).ok).toBe(true);
    expect(parseDiff(await getDiff(repo.root, 'a.txt', 'staged')).hunks).toHaveLength(0);
  });

  test('discards one hunk and can put it back', async () => {
    repo = makeRepo();
    repo.write('a.txt', twoHunks);
    const unstaged = parseDiff(await getDiff(repo.root, 'a.txt', 'unstaged'));
    const result = await discardHunk(repo.root, unstaged, 0);
    expect(result.ok).toBe(true);
    expect(repo.read('a.txt')).toStartWith('one\n');
    expect(repo.read('a.txt')).toContain('TEN');
    expect((await reapplyPatch(repo.root, result.patch!)).ok).toBe(true);
    expect(repo.read('a.txt')).toBe(twoHunks);
  });

  test('shows an untracked file as wholly added', async () => {
    repo = makeRepo();
    repo.write('new.txt', 'hello\n');
    expect(await getDiff(repo.root, 'new.txt', 'untracked')).toContain('+hello');
  });
});

import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { dropStash, getStashDiff, getStashes, popStash, pushStash, restoreStash } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('stash', () => {
  test('stashes with untracked files, shows, pops and drops', async () => {
    repo = makeRepo();
    repo.write('a.txt', 'wip\n');
    repo.write('new.txt', 'new');
    expect((await pushStash(repo.root, 'my wip')).ok).toBe(true);
    const [entry] = await getStashes(repo.root);
    expect(entry?.message).toContain('my wip');
    expect(await getStashDiff(repo.root, entry!.ref)).toContain('+wip');
    expect((await popStash(repo.root, entry!.ref)).ok).toBe(true);
    expect(repo.read('new.txt')).toBe('new');
    await pushStash(repo.root, 'second');
    const [second] = await getStashes(repo.root);
    const dropped = await dropStash(repo.root, second!);
    expect(dropped.ok).toBe(true);
    expect(await getStashes(repo.root)).toEqual([]);
    expect((await pushStash(repo.root, 'nothing')).ok).toBe(false);
    expect((await restoreStash(repo.root, dropped.hash!, second!.message)).ok).toBe(true);
    expect((await getStashes(repo.root))[0]?.message).toContain('second');
  });
});

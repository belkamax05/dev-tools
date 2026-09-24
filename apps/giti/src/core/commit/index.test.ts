import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { stage } from '../status';
import { commit, isHeadPushed } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('commit', () => {
  test('refuses with nothing staged or no message, commits, and amends', async () => {
    repo = makeRepo();
    expect((await commit(repo.root, 'msg')).ok).toBe(false);
    repo.write('a.txt', 'changed\n');
    await stage(repo.root, ['a.txt']);
    expect((await commit(repo.root, '  ')).ok).toBe(false);
    expect((await commit(repo.root, 'second')).message).toContain('second');
    repo.write('b.txt', 'b');
    await stage(repo.root, ['b.txt']);
    const amended = await commit(repo.root, '', { amend: true });
    expect(amended.message).toContain('Amended');
    expect(repo.sh(['log', '--format=%s'])).toBe('second\nfirst\n');
  });

  test('knows when HEAD is already pushed', async () => {
    repo = makeRepo({ remote: true });
    expect(await isHeadPushed(repo.root)).toBe(true);
    repo.write('a.txt', 'x');
    repo.sh(['commit', '-qam', 'local']);
    expect(await isHeadPushed(repo.root)).toBe(false);
  });
});

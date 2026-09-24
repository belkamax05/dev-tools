import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { createBranch, deleteBranch, getBranches, renameBranch, switchBranch } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('branches', () => {
  test('lists with tracking and merged state, and never deletes unmerged work', async () => {
    repo = makeRepo({ remote: true });
    await createBranch(repo.root, 'feature');
    repo.write('f.txt', 'f');
    repo.sh(['add', '.']);
    repo.sh(['commit', '-qm', 'feature work']);
    await createBranch(repo.root, 'done', 'main');
    const find = async (name: string) =>
      (await getBranches(repo.root)).find((b) => b.name === name)!;
    expect((await find('main')).upstream).toBe('origin/main');
    expect((await find('origin/main')).isRemote).toBe(true);
    expect((await find('done')).isCurrent).toBe(true);

    await switchBranch(repo.root, await find('main'));
    expect((await deleteBranch(repo.root, await find('feature'))).ok).toBe(false);
    expect((await deleteBranch(repo.root, await find('done'))).ok).toBe(true);
    expect((await renameBranch(repo.root, 'feature', 'feature-2')).ok).toBe(true);
    expect((await getBranches(repo.root)).some((b) => b.name === 'feature-2')).toBe(true);
  });
});

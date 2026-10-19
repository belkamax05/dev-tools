import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import {
  type Branch,
  createBranch,
  deleteBranch,
  deleteRemoteBranch,
  getBranches,
  mergeBranch,
  renameBranch,
  restoreBranch,
  switchArgs,
  sortBranches,
  switchBranch,
} from '.';

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
    expect((await find('feature')).author).toBe('Test');
    expect((await find('done')).isCurrent).toBe(true);

    await switchBranch(repo.root, await find('main'));
    expect((await deleteBranch(repo.root, await find('feature'))).ok).toBe(false);
    expect((await deleteBranch(repo.root, await find('done'))).ok).toBe(true);

    const forced = await deleteBranch(repo.root, await find('feature'), { force: true });
    expect(forced.ok).toBe(true);
    expect((await getBranches(repo.root)).some((b) => b.name === 'feature')).toBe(false);
    expect((await restoreBranch(repo.root, forced.undo!)).ok).toBe(true);
    expect(repo.sh(['log', '-1', '--format=%s', 'feature']).trim()).toBe('feature work');
    expect((await renameBranch(repo.root, 'feature', 'feature-2')).ok).toBe(true);
    expect((await getBranches(repo.root)).some((b) => b.name === 'feature-2')).toBe(true);
  });

  test('deletes a branch on its remote, and refuses a local one', async () => {
    repo = makeRepo({ remote: true });
    repo.sh(['push', '-q', 'origin', 'main:feature']);
    repo.sh(['fetch', '-q', 'origin']);
    const find = async (name: string) =>
      (await getBranches(repo.root)).find((b) => b.name === name);
    const remote = await find('origin/feature');
    if (!remote) throw new Error('missing origin/feature');
    expect((await deleteRemoteBranch(repo.root, (await find('main'))!)).ok).toBe(false);
    expect((await deleteRemoteBranch(repo.root, remote)).ok).toBe(true);
    expect(await find('origin/feature')).toBeUndefined();
    expect(repo.sh(['ls-remote', '--heads', 'origin', 'feature'])).toBe('');
  });

  test('sorts the checked-out branch first, then newest-first or by name', () => {
    const at = (name: string, timestamp: number, isCurrent = false) =>
      ({ name, timestamp, isCurrent }) as Branch;
    const branches = [at('b-old', 1), at('main', 2, true), at('c-new', 3), at('a-mid', 2)];
    expect(sortBranches(branches, 'time').map((b) => b.name)).toEqual([
      'main',
      'c-new',
      'a-mid',
      'b-old',
    ]);
    expect(sortBranches(branches, 'name').map((b) => b.name)).toEqual([
      'main',
      'a-mid',
      'b-old',
      'c-new',
    ]);
  });

  test('merges a branch into the checked-out one, never into itself', async () => {
    repo = makeRepo();
    repo.sh(['switch', '-q', '-c', 'feature']);
    repo.write('b.txt', 'feature\n');
    repo.sh(['add', '.']);
    repo.sh(['commit', '-qm', 'feature work']);
    repo.sh(['switch', '-q', 'main']);
    const branches = await getBranches(repo.root);
    const feature = branches.find((b) => b.name === 'feature');
    const main = branches.find((b) => b.name === 'main');
    if (!feature || !main) throw new Error('missing branch');
    expect((await mergeBranch(repo.root, main)).ok).toBe(false);
    expect((await mergeBranch(repo.root, feature)).ok).toBe(true);
    expect(repo.read('b.txt')).toBe('feature\n');
  });
});

describe('switchArgs', () => {
  const local = { name: 'feature/x', isRemote: false };
  const remote = { name: 'origin/feature/x', isRemote: true };

  test('a remote branch is switched to by its short name, which git makes track it', () => {
    expect(switchArgs(remote)).toEqual(['switch', 'feature/x']);
    expect(switchArgs(local)).toEqual(['switch', 'feature/x']);
  });

  test('--no-track spells out the new local branch, so it tracks nothing', () => {
    expect(switchArgs(remote, { noTrack: true })).toEqual([
      'switch',
      '-c',
      'feature/x',
      '--no-track',
      'origin/feature/x',
    ]);
    //? Once that local branch exists, it is only switched to
    expect(switchArgs(remote, { noTrack: true }, true)).toEqual(['switch', 'feature/x']);
  });

  test('--detach checks out the ref itself; --force and anything typed are added', () => {
    expect(switchArgs(remote, { detach: true })).toEqual(['switch', '--detach', 'origin/feature/x']);
    expect(switchArgs(local, { force: true, passthrough: ['--quiet'] })).toEqual([
      'switch',
      'feature/x',
      '--force',
      '--quiet',
    ]);
  });
});

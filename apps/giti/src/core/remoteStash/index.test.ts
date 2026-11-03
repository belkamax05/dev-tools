import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import makeRepo from '../testRepo';
import {
  applyRemoteStash,
  checkStashName,
  createStashCommit,
  getRemoteStashDiff,
  getRemoteStashes,
  getRemoteStashFiles,
  removeRemoteStash,
  resolveStashRemote,
  saveRemoteStash,
} from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

/** A teammate's clone of the same bare remote, sharing the test repository's temp folder. */
const cloneOf = (source: ReturnType<typeof makeRepo>) => {
  const root = join(source.base, 'mate');
  source.sh(['clone', '-q', '-b', 'main', join(source.base, 'remote.git'), root], source.base);
  source.sh(['config', 'user.email', 'mate@example.com'], root);
  source.sh(['config', 'user.name', 'Mate'], root);
  return root;
};

const status = (root: string) =>
  Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: root }).stdout.toString();

describe('remote stash', () => {
  test('saves staged, unstaged and untracked changes without touching the work tree', async () => {
    repo = makeRepo({ remote: true });
    repo.write('staged.txt', 'staged\n');
    repo.sh(['add', 'staged.txt']);
    repo.write('a.txt', 'changed\n');
    repo.write('new.txt', 'untracked\n');
    const before = status(repo.root);

    const saved = await saveRemoteStash(repo.root, 'origin', 'me/wip');
    expect(saved.ok).toBe(true);
    expect(status(repo.root)).toBe(before);

    const [entry] = await getRemoteStashes(repo.root, 'origin');
    expect(entry).toMatchObject({ name: 'me/wip', branch: 'main', author: 'Test' });
    const files = await getRemoteStashFiles(repo.root, entry!.hash);
    expect(files.map((file) => file.path).sort()).toEqual(['a.txt', 'new.txt', 'staged.txt']);
    expect(await getRemoteStashDiff(repo.root, entry!.hash)).toContain('+untracked');
  });

  test('a teammate applies it with what was staged still staged, and it stays on the remote', async () => {
    repo = makeRepo({ remote: true });
    repo.write('staged.txt', 'staged\n');
    repo.sh(['add', 'staged.txt']);
    repo.write('a.txt', 'changed\n');
    repo.write('new.txt', 'untracked\n');
    await saveRemoteStash(repo.root, 'origin', 'handover');

    const mate = cloneOf(repo);
    expect((await applyRemoteStash(mate, 'origin', 'handover')).ok).toBe(true);
    const lines = status(mate).split('\n').filter(Boolean).sort();
    expect(lines).toEqual([' M a.txt', '?? new.txt', 'A  staged.txt']);
    expect((await getRemoteStashes(mate, 'origin')).map((s) => s.name)).toEqual(['handover']);
  });

  test('applies everything unstaged when asked to', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'staged\n');
    repo.sh(['add', 'a.txt']);
    await saveRemoteStash(repo.root, 'origin', 'flat');
    const mate = cloneOf(repo);
    expect((await applyRemoteStash(mate, 'origin', 'flat', { index: false })).ok).toBe(true);
    expect(status(mate)).toBe(' M a.txt\n');
  });

  test('applies onto a branch that has moved on, merging against the commit it was taken on', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n');
    await saveRemoteStash(repo.root, 'origin', 'tail');
    const mate = cloneOf(repo);
    repo.sh(['commit', '-q', '-am', 'unrelated'], repo.root);
    Bun.write(join(mate, 'b.txt'), 'b\n');
    Bun.spawnSync(['sh', '-c', 'sed -i 1s/one/ONE/ a.txt && git commit -qam head'], { cwd: mate });
    expect((await applyRemoteStash(mate, 'origin', 'tail')).ok).toBe(true);
    expect(await Bun.file(join(mate, 'a.txt')).text()).toStartWith('ONE\n');
    expect(await Bun.file(join(mate, 'a.txt')).text()).toEndWith('TEN\n');
  });

  test('refuses to replace a stash of the same name unless forced', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'first\n');
    await saveRemoteStash(repo.root, 'origin', 'same');
    repo.write('a.txt', 'second\n');
    const again = await saveRemoteStash(repo.root, 'origin', 'same');
    expect(again.ok).toBe(false);
    expect(again.message).toContain('already has a stash named same');
    expect((await saveRemoteStash(repo.root, 'origin', 'same', { force: true })).ok).toBe(true);
    const [entry] = await getRemoteStashes(repo.root, 'origin');
    expect(await getRemoteStashDiff(repo.root, entry!.hash)).toContain('+second');
  });

  test('lists the most recent first and forgets one removed elsewhere', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'x\n');
    await saveRemoteStash(repo.root, 'origin', 'older');
    //? Committer dates have one-second resolution; the order is by date, not by push
    await Bun.sleep(1100);
    await saveRemoteStash(repo.root, 'origin', 'newer');
    expect((await getRemoteStashes(repo.root, 'origin')).map((s) => s.name)).toEqual([
      'newer',
      'older',
    ]);

    const mate = cloneOf(repo);
    expect((await removeRemoteStash(mate, 'origin', 'older')).ok).toBe(true);
    expect((await getRemoteStashes(repo.root, 'origin')).map((s) => s.name)).toEqual(['newer']);
    expect((await removeRemoteStash(mate, 'origin', 'older')).ok).toBe(false);
  });

  test('says so when there is nothing to stash or no such stash', async () => {
    repo = makeRepo({ remote: true });
    expect(await createStashCommit(repo.root, 'x')).toBeUndefined();
    expect((await saveRemoteStash(repo.root, 'origin', 'x')).message).toContain('Nothing to stash');
    const missing = await applyRemoteStash(repo.root, 'origin', 'ghost');
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain('no stash named ghost');
  });

  test('leaves no scratch index behind', async () => {
    repo = makeRepo({ remote: true });
    repo.write('new.txt', 'n\n');
    await createStashCommit(repo.root, 'x');
    expect(existsSync(join(repo.root, '.git', `giti-stash-${process.pid}-work`))).toBe(false);
    expect(existsSync(join(repo.root, '.git', `giti-stash-${process.pid}-untracked`))).toBe(false);
  });

  test('rejects names git cannot hold as a ref', async () => {
    repo = makeRepo();
    expect(await checkStashName(repo.root, 'me/fix-1')).toBeUndefined();
    expect(await checkStashName(repo.root, 'has space')).toBeDefined();
    expect(await checkStashName(repo.root, 'bad..name')).toBeDefined();
    expect(await checkStashName(repo.root, '')).toBeDefined();
  });

  test('shares through origin unless told otherwise, and fails without a remote', async () => {
    repo = makeRepo();
    await expect(resolveStashRemote(repo.root)).rejects.toThrow('No remote');
    repo.sh(['remote', 'add', 'upstream', repo.base]);
    expect(await resolveStashRemote(repo.root)).toBe('upstream');
    repo.sh(['remote', 'add', 'origin', repo.base]);
    expect(await resolveStashRemote(repo.root)).toBe('origin');
    expect(await resolveStashRemote(repo.root, 'upstream')).toBe('upstream');
    await expect(resolveStashRemote(repo.root, 'nope')).rejects.toThrow('not a remote');
  });
});

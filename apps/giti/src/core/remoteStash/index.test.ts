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
  getRemoteStashFileDiff,
  getRemoteStashFiles,
  matchChangedPaths,
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

  test('stashes only the chosen files, and the author’s index and work tree stay exactly as they were', async () => {
    repo = makeRepo({ remote: true });
    repo.write('b.txt', 'b\n');
    repo.write('c.txt', 'c\n');
    repo.sh(['add', 'b.txt', 'c.txt']);
    repo.sh(['commit', '-q', '-m', 'b and c']);
    repo.sh(['push', '-q']);
    repo.write('a.txt', 'left out\n');
    repo.write('b.txt', 'staged\n');
    repo.sh(['add', 'b.txt']);
    repo.write('b.txt', 'staged\nthen edited\n');
    repo.write('c.txt', 'left out too\n');
    repo.sh(['add', 'c.txt']);
    repo.write('keep.txt', 'chosen untracked\n');
    repo.write('skip.txt', 'other untracked\n');
    const before = [status(repo.root), repo.sh(['diff', '--cached']), repo.sh(['diff'])];

    const saved = await saveRemoteStash(repo.root, 'origin', 'part', {
      paths: ['b.txt', 'keep.txt'],
    });
    expect(saved.ok).toBe(true);
    expect([status(repo.root), repo.sh(['diff', '--cached']), repo.sh(['diff'])]).toEqual(before);
    expect((await getRemoteStashFiles(repo.root, saved.hash!)).map((f) => f.path).sort()).toEqual([
      'b.txt',
      'keep.txt',
    ]);

    const mate = cloneOf(repo);
    expect((await applyRemoteStash(mate, 'origin', 'part')).ok).toBe(true);
    expect(status(mate).split('\n').filter(Boolean).sort()).toEqual(['?? keep.txt', 'MM b.txt']);
    expect(await Bun.file(join(mate, 'b.txt')).text()).toBe('staged\nthen edited\n');
    expect(
      Bun.spawnSync(['git', 'show', ':b.txt'], { cwd: mate }).stdout.toString(),
    ).toBe('staged\n');
  });

  test('a chosen rename carries the old path’s removal, and binary files survive', async () => {
    repo = makeRepo({ remote: true });
    repo.sh(['mv', 'a.txt', 'moved.txt']);
    const bytes = new Uint8Array([0, 1, 2, 255, 0, 10, 13]);
    await Bun.write(join(repo.root, 'blob.bin'), bytes);
    repo.sh(['add', 'blob.bin']);
    const saved = await saveRemoteStash(repo.root, 'origin', 'mv', {
      paths: ['moved.txt', 'blob.bin'],
    });
    expect(saved.ok).toBe(true);

    const mate = cloneOf(repo);
    expect((await applyRemoteStash(mate, 'origin', 'mv')).ok).toBe(true);
    expect(existsSync(join(mate, 'a.txt'))).toBe(false);
    expect(existsSync(join(mate, 'moved.txt'))).toBe(true);
    expect(new Uint8Array(await Bun.file(join(mate, 'blob.bin')).arrayBuffer())).toEqual(bytes);
  });

  test('refuses an empty choice, and files with nothing to stash', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'changed\n');
    expect((await saveRemoteStash(repo.root, 'origin', 'x', { paths: [] })).message).toContain(
      'No files chosen',
    );
    expect(
      (await saveRemoteStash(repo.root, 'origin', 'x', { paths: ['clean.txt'] })).message,
    ).toContain('None of those files');
  });

  test('says, per file, which parts of the stash hold it, and shows each part', async () => {
    repo = makeRepo({ remote: true });
    repo.write('a.txt', 'staged\n');
    repo.sh(['add', 'a.txt']);
    repo.write('a.txt', 'staged\nthen edited\n');
    repo.write('new.txt', 'untracked\n');
    const saved = await saveRemoteStash(repo.root, 'origin', 'parts');
    const files = await getRemoteStashFiles(repo.root, saved.hash!);
    expect(files).toEqual([
      { path: 'a.txt', status: 'M', staged: true, unstaged: true, untracked: false },
      { path: 'new.txt', status: 'A', staged: false, unstaged: false, untracked: true },
    ]);
    const aDiff = await getRemoteStashFileDiff(repo.root, saved.hash!, files[0]!);
    expect(aDiff).toContain('### staged — arrives staged');
    expect(aDiff).toContain('### unstaged');
    expect(aDiff).toContain('+then edited');
    expect(await getRemoteStashFileDiff(repo.root, saved.hash!, files[1]!)).toContain('+untracked');
  });

  test('applies only the chosen files of a stash, staged ones still staged', async () => {
    repo = makeRepo({ remote: true });
    repo.write('b.txt', 'b\n');
    repo.sh(['add', 'b.txt']);
    repo.sh(['commit', '-q', '-m', 'b']);
    repo.sh(['push', '-q']);
    repo.write('a.txt', 'staged a\n');
    repo.sh(['add', 'a.txt']);
    repo.write('b.txt', 'left behind\n');
    repo.write('keep.txt', 'chosen untracked\n');
    repo.write('skip.txt', 'other untracked\n');
    await saveRemoteStash(repo.root, 'origin', 'whole');

    const mate = cloneOf(repo);
    const applied = await applyRemoteStash(mate, 'origin', 'whole', {
      paths: ['a.txt', 'keep.txt'],
    });
    expect(applied).toEqual({ ok: true, message: 'Applied 2 file(s) of stash whole' });
    expect(status(mate).split('\n').filter(Boolean).sort()).toEqual(['?? keep.txt', 'M  a.txt']);
    expect(await Bun.file(join(mate, 'b.txt')).text()).toBe('b\n');
    //? Narrowing is local: the stash on the remote still has every file
    const [entry] = await getRemoteStashes(mate, 'origin');
    expect((await getRemoteStashFiles(mate, entry!.hash)).map((f) => f.path)).toEqual([
      'a.txt',
      'b.txt',
      'keep.txt',
      'skip.txt',
    ]);
    expect(
      (await applyRemoteStash(mate, 'origin', 'whole', { paths: ['ghost.txt'] })).message,
    ).toContain('None of those files');
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
    for (const part of ['index', 'work', 'untracked'])
      expect(existsSync(join(repo.root, '.git', `giti-stash-${process.pid}-${part}`))).toBe(false);
  });

  test('typed paths pick a file, or every change under a folder', () => {
    const change = (path: string) =>
      ({ path, index: 'M', work: ' ', staged: true, unstaged: false, untracked: false, conflicted: false });
    const changes = ['src/a.ts', 'src/deep/b.ts', 'srcx/c.ts', 'd.ts'].map(change);
    const names = (typed: string[]) => matchChangedPaths(changes, typed).map((c) => c.path);
    expect(names(['src'])).toEqual(['src/a.ts', 'src/deep/b.ts']);
    expect(names(['src/'])).toEqual(['src/a.ts', 'src/deep/b.ts']);
    expect(names(['d.ts', 'nothing.ts'])).toEqual(['d.ts']);
    expect(names(['.'])).toHaveLength(4);
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

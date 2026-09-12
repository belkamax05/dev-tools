import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getRepoSnapshot from '.';
import gitExec from '../gitExec';

const initRepo = async (repo: string) => {
  await gitExec(['init', '-b', 'main'], repo);
  await gitExec(['config', 'user.email', 'test@example.com'], repo);
  await gitExec(['config', 'user.name', 'Test'], repo);
};

const commit = async (repo: string, name: string, message = name) => {
  await writeFile(join(repo, name), `${name}\n`);
  await gitExec(['add', name], repo);
  await gitExec(['commit', '-m', message], repo);
};

describe('getRepoSnapshot', () => {
  let repo = '';
  let bare = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'giti-snapshot-'));
    await initRepo(repo);
    await commit(repo, 'first.txt', 'first commit');
    await commit(repo, 'second.txt', 'second commit');

    //? A remote with an upstream, so the tracking fields have something to read.
    bare = await mkdtemp(join(tmpdir(), 'giti-snapshot-remote-'));
    await gitExec(['init', '--bare', '-b', 'main'], bare);
    await gitExec(['remote', 'add', 'origin', bare], repo);
    await gitExec(['push', '-u', 'origin', 'main'], repo);

    //? One of each kind of working-tree change, so the four buckets are all
    //? exercised by the same reading.
    await writeFile(join(repo, 'staged.txt'), 'staged\n');
    await gitExec(['add', 'staged.txt'], repo);
    await writeFile(join(repo, 'first.txt'), 'first\nmodified\n');
    await writeFile(join(repo, 'untracked.txt'), 'untracked\n');
  });

  afterAll(async () => {
    await Promise.all([
      rm(repo, { recursive: true, force: true }),
      rm(bare, { recursive: true, force: true }),
    ]);
  });

  test('reads branch, HEAD and its subject', async () => {
    const snapshot = await getRepoSnapshot(repo);

    expect(snapshot.isRepo).toBe(true);
    expect(snapshot.branch).toBe('main');
    expect(snapshot.detached).toBe(false);
    expect(snapshot.headFull).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.headFull.startsWith(snapshot.headShort)).toBe(true);
    expect(snapshot.headSubject).toBe('second commit');
  });

  test('sorts the working tree into its four buckets', async () => {
    const snapshot = await getRepoSnapshot(repo);

    expect(snapshot.staged.map((file) => file.path)).toEqual(['staged.txt']);
    expect(snapshot.modified.map((file) => file.path)).toEqual(['first.txt']);
    expect(snapshot.untracked.map((file) => file.path)).toEqual(['untracked.txt']);
    expect(snapshot.conflicted).toEqual([]);
  });

  test('reads the upstream it is tracking', async () => {
    const snapshot = await getRepoSnapshot(repo);

    expect(snapshot.upstream).toBe('main');
    expect(snapshot.remote).toBe('origin');
    expect(snapshot.remotes.map((entry) => entry.name)).toEqual(['origin']);
    expect(snapshot.ahead).toBe(0);
    expect(snapshot.behind).toBe(0);
  });

  test('lists commits newest first, with refs on the tip', async () => {
    const snapshot = await getRepoSnapshot(repo);

    expect(snapshot.commits.map((entry) => entry.subject)).toEqual([
      'second commit',
      'first commit',
    ]);
    expect(snapshot.commits[0]?.full).toBe(snapshot.headFull);
    expect(snapshot.commits[0]?.refs).toContain('HEAD');
  });

  /**
   * A subject containing the separator must not split into extra fields — the
   * whole reason the log format is joined on a control character rather than a
   * `|` the way the older status command does it.
   */
  test('survives a subject containing pipes', async () => {
    const noisy = await mkdtemp(join(tmpdir(), 'giti-snapshot-noisy-'));
    await initRepo(noisy);
    await commit(noisy, 'a.txt', 'feat: a|b|c and more');

    const snapshot = await getRepoSnapshot(noisy);
    expect(snapshot.commits[0]?.subject).toBe('feat: a|b|c and more');
    expect(snapshot.headSubject).toBe('feat: a|b|c and more');

    await rm(noisy, { recursive: true, force: true });
  });

  test('reports a directory outside any repository rather than throwing', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'giti-snapshot-plain-'));

    const snapshot = await getRepoSnapshot(plain);
    expect(snapshot.isRepo).toBe(false);
    expect(snapshot.root).toBe('');
    expect(snapshot.commits).toEqual([]);
    expect(snapshot.staged).toEqual([]);

    await rm(plain, { recursive: true, force: true });
  });
});

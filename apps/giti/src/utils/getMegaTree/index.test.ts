import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getMegaTree from '.';
import gitExec from '../gitExec';

describe('getMegaTree', () => {
  let repo = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'giti-mega-'));
    await gitExec(['init', '-b', 'main'], repo);
    await gitExec(['config', 'user.email', 'test@example.com'], repo);
    await gitExec(['config', 'user.name', 'Test'], repo);
    await writeFile(join(repo, 'README.md'), 'hello\n');
    await gitExec(['add', '.'], repo);
    await gitExec(['commit', '-m', 'first'], repo);
  });

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  test('reports the repository the vendored directories would live in', async () => {
    const tree = await getMegaTree(repo);

    expect(tree).not.toBeNull();
    expect(tree?.repo.name).toBe(repo.slice(repo.lastIndexOf('/') + 1));
    expect(tree?.repo.branch).toBe('main');
    expect(tree?.repo.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(tree?.repo.remote).toBe('');
    expect(tree?.repo.dirty).toEqual([]);
  });

  test('counts uncommitted work in the repository itself', async () => {
    await writeFile(join(repo, 'untracked.txt'), 'wip\n');
    const tree = await getMegaTree(repo);
    await rm(join(repo, 'untracked.txt'));

    expect(tree?.repo.dirty.length).toBe(1);
  });

  test('always reports all three mechanisms, empty ones included', async () => {
    const tree = await getMegaTree(repo);

    expect(tree?.groups.map((group) => group.kind)).toEqual(['subrepo', 'submodule', 'subtree']);
    expect(tree?.groups.every((group) => group.entries.length === 0)).toBe(true);
    expect(tree?.total).toBe(0);
  });

  test('totals every vendored directory across the mechanisms', async () => {
    const tree = await getMegaTree(process.cwd());
    const counted = tree?.groups.reduce((sum, group) => sum + group.entries.length, 0);

    expect(tree?.total).toBe(counted ?? -1);
  });

  test('returns nothing instead of guessing when the path is not a repository', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'giti-not-a-repo-'));
    const tree = await getMegaTree(outside);
    await rm(outside, { recursive: true, force: true });

    expect(tree).toBeNull();
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getSubtrees from '.';
import gitExec from '../gitExec';

/**
 * A commit carrying the trailers `git subtree add` writes — which is all `getSubtrees` reads — so
 * the fixture needs no `git subtree` installed.
 */
const addSubtree = async (repo: string, dir: string) => {
  await mkdir(join(repo, dir), { recursive: true });
  await writeFile(join(repo, dir, 'file.txt'), `${dir}\n`);
  await gitExec(['add', '.'], repo);
  const split = (await gitExec(['rev-parse', 'HEAD'], repo)).stdout.trim();
  await gitExec(
    ['commit', '-m', `Add '${dir}/'`, '-m', `git-subtree-dir: ${dir}\ngit-subtree-split: ${split}`],
    repo,
  );
};

describe('getSubtrees', () => {
  let repo = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'giti-subtrees-'));
    await gitExec(['init', '-b', 'main'], repo);
    await gitExec(['config', 'user.email', 'test@example.com'], repo);
    await gitExec(['config', 'user.name', 'Test'], repo);
    await writeFile(join(repo, 'README.md'), 'readme\n');
    await gitExec(['add', '.'], repo);
    await gitExec(['commit', '-m', 'init'], repo);

    await addSubtree(repo, 'kept');
    await addSubtree(repo, 'removed');
    await gitExec(['rm', '-r', '-q', 'removed'], repo);
    await gitExec(['commit', '-m', 'drop removed/'], repo);
  });

  afterAll(async () => {
    if (repo) await rm(repo, { recursive: true, force: true });
  });

  test('lists a subtree whose directory is still in the tree', async () => {
    const dirs = (await getSubtrees(repo)).map((entry) => entry.dir);

    expect(dirs).toContain('kept');
  });

  test('drops a subtree whose directory was deleted, though its trailers stay in history', async () => {
    const dirs = (await getSubtrees(repo)).map((entry) => entry.dir);

    expect(dirs).not.toContain('removed');
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cleanVendored from '.';
import gitExec from '../gitExec';

describe('cleanVendored', () => {
  let repo = '';

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'giti-clean-'));
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

  test('collects the per-entry fetch refs a status check leaves behind', async () => {
    const head = await gitExec(['rev-parse', 'HEAD'], repo);
    const ref = 'refs/giti/subtree/vendor/thing';
    await gitExec(['update-ref', ref, head.stdout.trim()], repo);

    const report = await cleanVendored('subtree', repo);

    expect(report.removed).toContain(ref);
    expect((await gitExec(['rev-parse', '--verify', ref], repo)).exitCode).not.toBe(0);
  });

  test('leaves everything in place when only asked what would go', async () => {
    const head = await gitExec(['rev-parse', 'HEAD'], repo);
    const ref = 'refs/giti/subtree/vendor/kept';
    await gitExec(['update-ref', ref, head.stdout.trim()], repo);

    const report = await cleanVendored('subtree', repo, { dryRun: true });

    expect(report.removed).toContain(ref);
    expect((await gitExec(['rev-parse', '--verify', ref], repo)).exitCode).toBe(0);
    await gitExec(['update-ref', '-d', ref], repo);
  });

  test('removes cloned history no .gitmodules entry claims any more', async () => {
    const orphan = join(repo, '.git', 'modules', 'libs', 'gone');
    await mkdir(orphan, { recursive: true });
    await writeFile(join(orphan, 'HEAD'), 'ref: refs/heads/main\n');

    const report = await cleanVendored('submodule', repo);

    expect(report.removed).toContain('.git/modules/libs/gone');
    expect(existsSync(orphan)).toBe(false);
  });

  test('reports rather than throws when there is no repository to clean', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'giti-not-a-repo-'));
    const report = await cleanVendored('subrepo', outside);
    await rm(outside, { recursive: true, force: true });

    expect(report.removed).toEqual([]);
    expect(report.notes.join(' ')).toContain('Not inside a git repository');
  });
});

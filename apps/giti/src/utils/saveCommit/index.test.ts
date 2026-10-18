import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import gitExec from '../gitExec';
import saveCommit from '.';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const repository = async () => {
  const root = await mkdtemp(join(process.cwd(), '.save-test-'));
  roots.push(root);
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Save Test'],
    ['config', 'user.email', 'save@example.test'],
    ['config', 'commit.gpgsign', 'false'],
    ['config', 'core.hooksPath', '/dev/null'],
  ]) {
    expect((await gitExec(args, root)).exitCode).toBe(0);
  }
  await writeFile(join(root, 'change.txt'), 'change\n');
  expect((await gitExec(['add', 'change.txt'], root)).exitCode).toBe(0);
  return root;
};

test('commits staged changes without pushing when push is off', async () => {
  const root = await repository();
  let pushed = false;
  const result = await saveCommit(root, ['commit', '-m', 'saved'], false, {
    send: async () => {
      pushed = true;
    },
  });
  expect(result.exitCode).toBe(0);
  expect(pushed).toBe(false);
  expect((await gitExec(['log', '-1', '--format=%s'], root)).stdout.trim()).toBe('saved');
});

test('pushes only after the new commit exists', async () => {
  const root = await repository();
  let subject = '';
  const result = await saveCommit(root, ['commit', '-m', 'push me'], true, {
    send: async () => {
      subject = (await gitExec(['log', '-1', '--format=%s'], root)).stdout.trim();
    },
  });
  expect(result.exitCode).toBe(0);
  expect(subject).toBe('push me');
});

test('does not push when committing fails', async () => {
  const root = await repository();
  let pushed = false;
  const result = await saveCommit(root, ['commit', '--invalid-save-test-flag'], true, {
    send: async () => {
      pushed = true;
    },
  });
  expect(result.exitCode).not.toBe(0);
  expect(pushed).toBe(false);
});

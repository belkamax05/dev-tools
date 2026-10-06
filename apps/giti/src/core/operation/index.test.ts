import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { getChanges } from '../status';
import { abortOperation, continueOperation, getOperation, resolveFile } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const conflict = () => {
  repo = makeRepo();
  repo.sh(['switch', '-qc', 'other']);
  repo.write('a.txt', 'theirs\n');
  repo.sh(['commit', '-qam', 'theirs']);
  repo.sh(['switch', '-q', 'main']);
  repo.write('a.txt', 'ours\n');
  repo.sh(['commit', '-qam', 'ours']);
  Bun.spawnSync(['git', 'merge', 'other'], { cwd: repo.root, stdout: 'ignore', stderr: 'ignore' });
};

describe('operation', () => {
  test('detects a merge in progress and its conflicted file, and aborts it', async () => {
    conflict();
    const op = await getOperation(repo.root);
    expect(op?.kind).toBe('merge');
    expect((await getChanges(repo.root)).find((c) => c.path === 'a.txt')?.conflicted).toBe(true);
    expect((await abortOperation(repo.root, op!)).ok).toBe(true);
    expect(await getOperation(repo.root)).toBeUndefined();
  });

  test('resolves by taking a side, then continues without an editor', async () => {
    conflict();
    const op = await getOperation(repo.root);
    expect((await resolveFile(repo.root, 'a.txt', 'theirs')).ok).toBe(true);
    expect(repo.read('a.txt')).toBe('theirs\n');
    expect((await continueOperation(repo.root, op!)).ok).toBe(true);
    expect(await getOperation(repo.root)).toBeUndefined();
  });
});

import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { join } from 'node:path';

import {
  fetchAll,
  getRemotes,
  pullCurrent,
  pullMega,
  pushCurrent,
  removeRemote,
  restoreRemote,
} from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('remotes', () => {
  test('lists remotes, pushes (setting the upstream on a first push), fetches and pulls', async () => {
    repo = makeRepo({ remote: true });
    expect((await getRemotes(repo.root))[0]?.name).toBe('origin');
    repo.sh(['switch', '-qc', 'topic']);
    repo.write('t.txt', 't');
    repo.sh(['add', '.']);
    repo.sh(['commit', '-qm', 'topic']);
    const progress: string[] = [];
    const pushed = await pushCurrent(repo.root, { onProgress: (line) => progress.push(line) });
    expect(pushed.message).toContain('set it as upstream');
    expect(repo.sh(['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe('origin/topic');
    expect((await fetchAll(repo.root)).ok).toBe(true);
    expect((await pullCurrent(repo.root)).ok).toBe(true);
  });

  test('removes a remote with everything it took along, and restores it exactly', async () => {
    repo = makeRepo({ remote: true });
    //? The parts `git remote remove` deletes besides the URL: an extra refspec, a push URL,
    //? the tracking refs (a symbolic HEAD among them) and main's upstream.
    repo.sh(['config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*']);
    repo.sh(['config', 'remote.origin.pushurl', 'git@example.com:me/repo.git']);
    repo.sh(['remote', 'set-head', 'origin', 'main']);
    const config = () => repo.sh(['config', '--local', '--list']).split('\n').sort().join('\n');
    const refs = () => repo.sh(['for-each-ref', '--format=%(refname) %(objectname) %(symref)']);
    const before = { config: config(), refs: refs() };

    const removed = await removeRemote(repo.root, 'origin');
    expect(removed.ok).toBe(true);
    expect(removed.message).toContain('1 branch no longer track');
    expect(await getRemotes(repo.root)).toEqual([]);
    expect(refs()).not.toContain('refs/remotes/origin');
    expect(() => repo.sh(['rev-parse', '--abbrev-ref', '@{u}'])).toThrow();

    const restored = await restoreRemote(repo.root, removed.undo!);
    expect(restored.ok).toBe(true);
    expect(config()).toBe(before.config);
    expect(refs()).toBe(before.refs);
    expect(repo.sh(['rev-parse', '--abbrev-ref', '@{u}']).trim()).toBe('origin/main');
  });

  test('reports a remote that does not exist instead of throwing', async () => {
    repo = makeRepo();
    const removed = await removeRemote(repo.root, 'nope');
    expect(removed.ok).toBe(false);
    expect(removed.undo).toBeUndefined();
  });

  test('mega pull brings the repository up to date and reports its steps', async () => {
    repo = makeRepo({ remote: true });
    const other = join(repo.base, 'other');
    repo.sh(['clone', '-q', '-b', 'main', join(repo.base, 'remote.git'), other], repo.base);
    repo.sh(['config', 'user.email', 'test@example.com'], other);
    repo.sh(['config', 'user.name', 'Test'], other);
    repo.sh(['commit', '-q', '--allow-empty', '-m', 'upstream work'], other);
    repo.sh(['push', '-q'], other);

    const steps: string[] = [];
    const result = await pullMega(repo.root, (line) => steps.push(line));
    expect(result.ok).toBe(true);
    expect(steps.length).toBeGreaterThan(1);
    expect(repo.sh(['log', '-1', '--format=%s']).trim()).toBe('upstream work');
  }, 30_000);
});

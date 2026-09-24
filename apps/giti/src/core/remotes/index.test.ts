import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { fetchAll, getRemotes, pullCurrent, pushCurrent } from '.';

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
});

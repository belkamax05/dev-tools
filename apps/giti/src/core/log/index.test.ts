import { afterEach, describe, expect, test } from 'bun:test';

import makeRepo from '../testRepo';
import { branchAt, getCommitDetail, getLog, revertCommit } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

describe('log', () => {
  test('pages, draws a graph, and details a commit', async () => {
    repo = makeRepo();
    for (const n of [2, 3, 4]) {
      repo.write('a.txt', `v${n}\n`);
      repo.sh(['commit', '-qam', `commit ${n}`]);
    }
    const page = await getLog(repo.root, { skip: 1, limit: 2 });
    expect(page.map((line) => line.kind === 'commit' && line.subject)).toEqual([
      'commit 3',
      'commit 2',
    ]);
    const graph = await getLog(repo.root, { graph: true, limit: 2 });
    expect(graph[0]?.kind === 'commit' && graph[0].graph).toContain('*');
    const top = page[0];
    if (top?.kind !== 'commit') throw new Error('no commit');
    const detail = await getCommitDetail(repo.root, top.hash);
    expect(detail?.subject).toBe('commit 3');
    expect(detail?.stat.join('\n')).toContain('a.txt');
  });

  test('reverts a commit without an editor, and branches at one', async () => {
    repo = makeRepo();
    repo.write('a.txt', 'changed\n');
    repo.sh(['commit', '-qam', 'change']);
    const [head] = await getLog(repo.root, { limit: 1 });
    if (head?.kind !== 'commit') throw new Error('no commit');
    expect((await revertCommit(repo.root, head.hash)).ok).toBe(true);
    expect(repo.read('a.txt')).toStartWith('one');
    expect((await branchAt(repo.root, 'at-change', head.hash)).ok).toBe(true);
  });
});

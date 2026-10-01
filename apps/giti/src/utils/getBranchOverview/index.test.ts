import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import makeRepo from '../../core/testRepo';
import getDefaultBranch from '../getDefaultBranch';
import getBranchOverview from '.';

describe('getBranchOverview', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeAll(() => {
    repo = makeRepo({ remote: true });
    const { sh, write } = repo;
    //? `feature` is two commits ahead of main; `done` is merged into main; `shared` lives only on
    //? the remote; main then gets one commit of its own so `feature` is also behind
    sh(['switch', '-q', '-c', 'done']);
    write('done.txt', 'done\n');
    sh(['add', '.']);
    sh(['commit', '-q', '-m', 'done']);
    sh(['switch', '-q', 'main']);
    sh(['merge', '-q', '--ff-only', 'done']);
    sh(['switch', '-q', '-c', 'feature']);
    for (const n of [1, 2]) {
      write(`f${n}.txt`, `${n}\n`);
      sh(['add', '.']);
      sh(['commit', '-q', '-m', `feature ${n}`]);
    }
    sh(['push', '-q', 'origin', 'feature:shared']);
    sh(['switch', '-q', 'main']);
    write('main.txt', 'main\n');
    sh(['add', '.']);
    sh(['commit', '-q', '-m', 'main moves on']);
    sh(['push', '-q', 'origin', 'main']);
    sh(['switch', '-q', 'feature']);
  });

  afterAll(() => repo?.cleanup());

  test('measures each branch against a base in both directions', async () => {
    const { rows } = await getBranchOverview(repo.root, ['main']);
    const feature = rows.find((row) => row.name === 'feature');

    expect(feature?.divergence.main).toEqual({ ahead: 2, behind: 1 });
    expect(feature?.isCurrent).toBe(true);
  });

  test('reports which bases already contain a branch', async () => {
    const { rows } = await getBranchOverview(repo.root, ['main']);

    expect(rows.find((row) => row.name === 'done')?.mergedInto).toEqual(['main']);
    expect(rows.find((row) => row.name === 'feature')?.mergedInto).toEqual([]);
  });

  test('lists remote-only branches from the remote unless asked for local ones alone', async () => {
    const all = await getBranchOverview(repo.root, ['main']);
    const shared = all.rows.find((row) => row.name === 'shared');

    expect(shared?.isRemoteOnly).toBe(true);
    expect(shared?.ref).toBe('origin/shared');
    expect(all.rows.some((row) => row.name === 'HEAD')).toBe(false);

    const local = await getBranchOverview(repo.root, ['main'], { localOnly: true });
    expect(local.rows.some((row) => row.name === 'shared')).toBe(false);
  });

  test('puts the base first and never compares it with itself', async () => {
    const { rows } = await getBranchOverview(repo.root, ['main']);

    expect(rows[0]?.name).toBe('main');
    expect(rows[0]?.divergence).toEqual({});
  });

  test('names a base that does not exist instead of comparing against nothing', async () => {
    const overview = await getBranchOverview(repo.root, ['main', 'nope']);

    expect(overview.bases).toEqual(['main']);
    expect(overview.missingBases).toEqual(['nope']);
  });

  test('finds the trunk without a remote HEAD pointer by falling back to main', async () => {
    expect(await getDefaultBranch(repo.root)).toBe('main');
  });
});

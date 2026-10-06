import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import makeRepo from '../../core/testRepo';
import resolveRepoPaths from '.';

describe('resolveRepoPaths', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeAll(() => {
    repo = makeRepo();
    repo.write('pkg/src/a.ts', 'a\n');
  });

  afterAll(() => repo?.cleanup());

  test('reads paths typed in a subfolder relative to the repository root', async () => {
    const result = await resolveRepoPaths(join(repo.root, 'pkg'), ['src/a.ts', '../a.txt'], '');

    expect(result.paths).toEqual(['pkg/src/a.ts', 'a.txt']);
    expect(realpathSync(result.root)).toBe(realpathSync(repo.root));
  });

  test('puts back the subfolder git moved away from when run through an alias', async () => {
    const result = await resolveRepoPaths(repo.root, ['a.ts'], 'pkg/src/');

    expect(result.paths).toEqual(['pkg/src/a.ts']);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findProjectConfig, loadClearOptions, mergeClearOptions } from './index';

let base: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'giti-project-'));
  mkdirSync(join(base, 'repo', 'src'), { recursive: true });
  writeFileSync(
    join(base, 'repo', 'giti.config.ts'),
    `export default { clear: { preselect: ['**/dist'], hide: ['.env*', 42] } };`,
  );
  mkdirSync(join(base, 'wrapper'));
  writeFileSync(
    join(base, 'wrapper', 'giti.config.ts'),
    `export default ({ root }) => ({ clear: { preselect: root.endsWith('repo') ? ['**/.next'] : ['other'] } });`,
  );
  mkdirSync(join(base, 'broken'));
  writeFileSync(join(base, 'broken', 'giti.config.ts'), `throw new Error('boom');`);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('giti.config.ts', () => {
  test('finds the nearest config by walking up from a subfolder', () => {
    expect(findProjectConfig(join(base, 'repo', 'src'))).toBe(join(base, 'repo', 'giti.config.ts'));
  });

  test('reads the clear rules, dropping anything that is not a pattern', async () => {
    const result = await loadClearOptions(join(base, 'repo'), {});
    expect(result.options).toEqual({ hide: ['.env*'], preselect: ['**/dist'] });
    expect(result.errors).toEqual([]);
  });

  test('merges in the file GITI_CONFIG names, calling it with the repository it serves', async () => {
    const result = await loadClearOptions(join(base, 'repo'), {
      GITI_CONFIG: join(base, 'wrapper', 'giti.config.ts'),
    });
    expect(result.options.preselect).toEqual(['**/dist', '**/.next']);
    expect(result.paths).toHaveLength(2);
  });

  test('reports a config that throws instead of failing the run', async () => {
    const result = await loadClearOptions(join(base, 'broken'), {
      GITI_CONFIG: join(base, 'missing.ts'),
    });
    expect(result.options).toEqual({ hide: [], preselect: [] });
    expect(result.errors).toHaveLength(2);
  });

  test('stacks typed flags on top of a config', () => {
    expect(mergeClearOptions({ hide: ['a'] }, { hide: ['b'], preselect: ['c'] })).toEqual({
      hide: ['a', 'b'],
      preselect: ['c'],
    });
  });
});

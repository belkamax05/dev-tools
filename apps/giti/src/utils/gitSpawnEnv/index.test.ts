import { afterEach, describe, expect, test } from 'bun:test';
import gitSpawnEnv from '.';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('gitSpawnEnv', () => {
  test('drops inherited repository overrides', () => {
    process.env.GIT_DIR = '/other/repo/.git';
    process.env.GIT_WORK_TREE = '/other/repo';
    process.env.GIT_INDEX_FILE = '/other/repo/.git/index';

    const env = gitSpawnEnv();

    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  test('keeps unrelated variables', () => {
    process.env.GIT_EDITOR = 'true';
    process.env.PATH_MARKER = 'kept';

    const env = gitSpawnEnv();

    expect(env.GIT_EDITOR).toBe('true');
    expect(env.PATH_MARKER).toBe('kept');
  });

  test('does not mutate process.env', () => {
    process.env.GIT_DIR = '/other/repo/.git';

    gitSpawnEnv();

    expect(process.env.GIT_DIR).toBe('/other/repo/.git');
  });
});

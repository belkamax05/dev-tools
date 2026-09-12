import { describe, expect, test } from 'bun:test';
import gitSpawnCwd from '.';

describe('gitSpawnCwd', () => {
  test('returns an absolute path unchanged', () => {
    expect(gitSpawnCwd('/home/user/project')).toBe('/home/user/project');
  });

  test('rejects an empty path instead of falling back to the current folder', () => {
    expect(() => gitSpawnCwd('')).toThrow();
    expect(() => gitSpawnCwd('   ')).toThrow();
    expect(() => gitSpawnCwd(undefined as never)).toThrow();
  });
});

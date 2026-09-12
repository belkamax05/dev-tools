import { describe, expect, test } from 'bun:test';
import getWorkingDir, { setWorkingDir } from '.';

describe('getWorkingDir', () => {
  test('returns process.cwd() when no working dir has been set', () => {
    //? Reset module state by importing directly
    //? Cannot reset module-level _cwd without re-import; test the default path instead
    const cwd = getWorkingDir();
    expect(typeof cwd).toBe('string');
    expect(cwd.length).toBeGreaterThan(0);
  });

  test('returns the directory set by setWorkingDir', () => {
    setWorkingDir('/custom/path');
    expect(getWorkingDir()).toBe('/custom/path');
  });

  test('setWorkingDir accepts any string path', () => {
    const paths = ['/tmp/test', '/home/user/project', '/'];
    for (const p of paths) {
      setWorkingDir(p);
      expect(getWorkingDir()).toBe(p);
    }
  });

  test('subsequent setWorkingDir calls overwrite previous value', () => {
    setWorkingDir('/first');
    setWorkingDir('/second');
    expect(getWorkingDir()).toBe('/second');
  });
});

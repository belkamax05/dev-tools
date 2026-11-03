import { describe, expect, test } from 'bun:test';

import parseStashArgs from '.';

describe('parseStashArgs', () => {
  test('reads the name and every flag the stash commands take', () => {
    expect(parseStashArgs(['me/wip', '--remote=upstream', '-y', '--force', '--unstaged'])).toEqual({
      name: 'me/wip',
      remote: 'upstream',
      yes: true,
      force: true,
      unstaged: true,
    });
  });

  test('defaults every flag off and leaves the name out when none is given', () => {
    expect(parseStashArgs([])).toEqual({ yes: false, force: false, unstaged: false });
  });

  test('takes a name as listed, refs/stashes/ prefix and all', () => {
    expect(parseStashArgs(['refs/stashes/fix']).name).toBe('fix');
  });

  test('joins words typed without quotes, since a stash name holds no spaces', () => {
    expect(parseStashArgs(['login', 'fix']).name).toBe('login-fix');
  });

  test('takes files after --, so a name is never read as a file or a file as a flag', () => {
    expect(parseStashArgs(['wip', '--', 'src/a.ts', '--odd-name.ts'])).toEqual({
      name: 'wip',
      yes: false,
      force: false,
      unstaged: false,
      paths: ['src/a.ts', '--odd-name.ts'],
    });
    expect(parseStashArgs(['wip', '--']).paths).toBeUndefined();
  });

  test('rejects a flag no stash command takes instead of ignoring it', () => {
    expect(() => parseStashArgs(['--keep-index'])).toThrow();
  });
});

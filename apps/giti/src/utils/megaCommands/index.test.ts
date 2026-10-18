import { describe, expect, test } from 'bun:test';
import { isDryRun, splitTransferTarget } from '.';

describe('splitTransferTarget', () => {
  const remotes = ['origin', 'upstream'];

  test('reads a leading remote and the branch after it, as git push and git pull do', () => {
    expect(splitTransferTarget(['origin', 'main', '--no-verify'], remotes)).toEqual({
      target: { remote: 'origin', branch: 'main' },
      rest: ['--no-verify'],
    });
  });

  test('leaves a positional that is no remote as a vendored directory', () => {
    expect(splitTransferTarget(['libs/dev-tools', '--rebase'], remotes)).toEqual({
      target: {},
      rest: ['libs/dev-tools', '--rebase'],
    });
  });

  test('takes a remote alone without inventing a branch', () => {
    expect(splitTransferTarget(['upstream'], remotes)).toEqual({
      target: { remote: 'upstream' },
      rest: [],
    });
  });

  test('passes everything after -- through untouched, remote names included', () => {
    expect(splitTransferTarget(['--', 'origin'], remotes)).toEqual({
      target: {},
      rest: ['--', 'origin'],
    });
  });
});

describe('isDryRun', () => {
  test('knows both spellings git push takes', () => {
    expect(isDryRun(['--dry-run'])).toBe(true);
    expect(isDryRun(['-n'])).toBe(true);
    expect(isDryRun(['--no-verify'])).toBe(false);
  });
});

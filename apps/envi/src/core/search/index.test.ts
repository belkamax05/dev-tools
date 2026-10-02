import { describe, expect, test } from 'bun:test';

import { matchesSearch } from './index';

describe('matchesSearch', () => {
  test('one box matches names and values, case-insensitively', () => {
    expect(matchesSearch('NODE_ENV', 'production', 'node')).toBe(true);
    expect(matchesSearch('NODE_ENV', 'production', 'PROD')).toBe(true);
    expect(matchesSearch('NODE_ENV', 'production', 'staging')).toBe(false);
  });

  test('words are ANDed, each across name or value', () => {
    expect(matchesSearch('NODE_ENV', 'production', 'node prod')).toBe(true);
    expect(matchesSearch('NODE_ENV', 'production', 'node staging')).toBe(false);
  });

  test('k: and v: limit a word to one side', () => {
    expect(matchesSearch('PATH', '/nix/store/x', 'v:nix')).toBe(true);
    expect(matchesSearch('PATH', '/nix/store/x', 'k:nix')).toBe(false);
    expect(matchesSearch('NIX_PATH', '/x', 'k:nix')).toBe(true);
  });

  test('an empty search matches everything', () => {
    expect(matchesSearch('A', 'b', '  ')).toBe(true);
  });
});

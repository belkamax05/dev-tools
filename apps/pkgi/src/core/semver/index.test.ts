import { describe, expect, test } from 'bun:test';

import { cleanVersion, compareVersions, isLocalSpec, rangePrefix, updateKind } from './index';

describe('semver', () => {
  test('cleanVersion finds the version in a range', () => {
    expect(cleanVersion('^19.1.0')).toBe('19.1.0');
    expect(cleanVersion('~1.2.3-beta.1')).toBe('1.2.3-beta.1');
    expect(cleanVersion('workspace:*')).toBe('');
  });

  test('compareVersions orders prereleases below their release, numerically', () => {
    const sorted = ['1.0.0', '1.0.0-rc.10', '1.0.0-rc.2', '0.9.9', '1.0.0-alpha'].sort(
      compareVersions,
    );
    expect(sorted).toEqual(['0.9.9', '1.0.0-alpha', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0']);
  });

  test('updateKind labels the jump, and is none when not behind', () => {
    expect(updateKind('1.2.3', '2.0.0')).toBe('major');
    expect(updateKind('1.2.3', '1.3.0')).toBe('minor');
    expect(updateKind('1.2.3', '1.2.4')).toBe('patch');
    expect(updateKind('1.2.3', '1.3.0-beta.1')).toBe('prerelease');
    expect(updateKind('1.2.3', '1.2.3')).toBe('none');
    expect(updateKind('2.0.0', '1.9.0')).toBe('none');
  });

  test('rangePrefix keeps ^ and ~ and exact pins; says nothing about the rest', () => {
    expect(rangePrefix('^1.0.0')).toBe('^');
    expect(rangePrefix('~1.0.0')).toBe('~');
    expect(rangePrefix('1.0.0')).toBe('');
    expect(rangePrefix('>=1')).toBeUndefined();
  });

  test('isLocalSpec spots specs that are not a registry range for the declared name', () => {
    for (const spec of ['workspace:*', 'file:../x', 'npm:other@1', 'github:a/b', 'git+https://x']) {
      expect(isLocalSpec(spec)).toBe(true);
    }
    expect(isLocalSpec('^1.2.0')).toBe(false);
  });
});

import { describe, expect, test } from 'bun:test';
import { describeVendored } from '.';
import type { Vendored, VendoredState } from '../vendored';

const vendored: Vendored = {
  kind: 'submodule',
  dir: 'libs/giti',
  path: '/tmp/parent/libs/giti',
  remote: 'git@example.com:me/giti.git',
  branch: 'main',
  commit: 'a'.repeat(40),
};

const state = (overrides: Partial<VendoredState> = {}): VendoredState => ({
  vendored,
  behind: 0,
  upstreamRef: 'b'.repeat(40),
  localChanges: [],
  ahead: 0,
  gitlinkBehind: 0,
  dirty: [],
  ...overrides,
});

/** Colour codes are noise here; the wording is what the report is judged on. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const plain = (text: string) => text.replaceAll(ANSI, '');

describe('describeVendored', () => {
  test('calls a submodule up to date when only the parent pointer is stale', () => {
    const described = describeVendored(
      state({ gitlinkBehind: 2, localChanges: ['a.ts', 'b.ts'] }),
      'submodule',
      true,
    );

    expect(plain(described.label)).toBe('parent gitlink 2 commits behind');
    expect(described.label).not.toContain('behind, ');
    expect(described.hint).toBe('commit the moved gitlink in the parent');
  });

  test('asks for a push in commits, not in the files those commits touched', () => {
    const described = describeVendored(
      state({ ahead: 3, localChanges: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] }),
      'submodule',
      true,
    );

    expect(plain(described.label)).toBe('3 commits to push');
    expect(described.hint).toBe('giti submodule/push libs/giti');
  });

  test('orders pull, push and pointer update the way they have to happen', () => {
    const described = describeVendored(
      state({ behind: 1, ahead: 2, gitlinkBehind: 2 }),
      'submodule',
      true,
    );

    expect(plain(described.label)).toBe(
      '1 commit behind, 2 commits to push, parent gitlink 2 commits behind',
    );
    expect(described.hint).toBe(
      'giti submodule/pull libs/giti, then giti submodule/push libs/giti, then commit the moved gitlink in the parent',
    );
  });

  test('still measures a subrepo against the commit it is pinned to', () => {
    const subrepo = { ...vendored, kind: 'subrepo' as const, dir: 'libs/utils' };
    const described = describeVendored(
      { ...state({ localChanges: ['a.ts'] }), vendored: subrepo },
      'subrepo',
      true,
    );

    expect(plain(described.label)).toBe('1 local change');
    expect(described.hint).toBe('giti subrepo/push libs/utils');
  });

  test('says nothing about upstream when it was never contacted', () => {
    const described = describeVendored(state({ behind: null, ahead: null }), 'submodule', false);

    expect(plain(described.label)).toBe('no local changes');
    expect(described.hint).toBe('');
  });
});

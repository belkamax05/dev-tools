import { describe, expect, test } from 'bun:test';
import type { Branch } from '../../core/branches';
import getSendToTargets, { pickSendToRemote } from '.';

const branch = (name: string, overrides: Partial<Branch> = {}): Branch => ({
  name,
  isRemote: false,
  isCurrent: false,
  upstream: '',
  ahead: 0,
  behind: 0,
  gone: false,
  merged: false,
  subject: `tip of ${name}`,
  author: 'someone',
  when: '1 day ago',
  timestamp: 100,
  ...overrides,
});

describe('getSendToTargets', () => {
  test('never offers the checked-out branch, locally or on the remote', () => {
    const targets = getSendToTargets(
      [branch('main', { isCurrent: true }), branch('origin/main', { isRemote: true })],
      'main',
      'origin',
    );
    expect(targets).toEqual([]);
  });

  test("lists one row per name, describing the remote's copy when there is one", () => {
    const targets = getSendToTargets(
      [
        branch('staging', { subject: 'local tip' }),
        branch('origin/staging', { isRemote: true, subject: 'remote tip' }),
      ],
      'main',
      'origin',
    );
    expect(targets).toEqual([
      { name: 'staging', onRemote: true, subject: 'remote tip', when: '1 day ago', timestamp: 100 },
    ]);
  });

  test('offers a local-only branch as one the push would create', () => {
    const [target] = getSendToTargets([branch('draft')], 'main', 'origin');
    expect(target?.onRemote).toBe(false);
  });

  test("leaves out other remotes' branches and sorts newest first", () => {
    const targets = getSendToTargets(
      [
        branch('origin/old', { isRemote: true, timestamp: 1 }),
        branch('origin/new', { isRemote: true, timestamp: 9 }),
        branch('fork/other', { isRemote: true, timestamp: 5 }),
      ],
      'main',
      'origin',
    );
    expect(targets.map((target) => target.name)).toEqual(['new', 'old']);
  });
});

describe('pickSendToRemote', () => {
  test('uses the remote the current branch tracks, even one with a slash in its name', () => {
    expect(pickSendToRemote('team/fork/main', ['origin', 'team/fork'])).toBe('team/fork');
  });

  test('falls back to remote.pushdefault, then origin, then any remote', () => {
    expect(pickSendToRemote('', ['origin', 'mine'], 'mine')).toBe('mine');
    expect(pickSendToRemote('', ['upstream', 'origin'])).toBe('origin');
    expect(pickSendToRemote('', ['upstream'])).toBe('upstream');
    expect(pickSendToRemote('', [])).toBeUndefined();
  });
});

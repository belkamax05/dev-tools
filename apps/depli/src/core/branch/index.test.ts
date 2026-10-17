import { describe, expect, test } from 'bun:test';

import { matchesPatterns } from '../plugin';
import { pickRecentBranches, resolveSelection } from '.';

describe('resolveSelection', () => {
  test('keeps the saved pick, whatever the checkout is on', () => {
    const saved = { selected: 'release-26.16', pickedWhileOn: 'develop' };
    expect(resolveSelection(saved)).toEqual({ branch: 'release-26.16', selection: saved });
  });

  test('no pick means no branch yet — the provider list supplies one', () => {
    expect(resolveSelection({}).branch).toBeUndefined();
  });
});

describe('matchesPatterns', () => {
  const watch = ['master', 'develop', 'release-*', '!release-sprint-*'];
  test.each([
    ['master', true],
    ['release-26.16', true],
    ['release-sprint-26.14', false],
    ['feature/x', false],
  ])('%s → %p', (name, expected) => {
    expect(matchesPatterns(name, watch)).toBe(expected);
  });

  test('only exclusions means everything else', () => {
    expect(matchesPatterns('feature/x', ['!release-*'])).toBe(true);
  });
});

describe('pickRecentBranches', () => {
  //? Day n of October: a bigger n is a newer commit
  const at = (name: string, day: number) => ({
    name,
    sha: name,
    committedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`,
  });
  const rule = {
    limit: 12,
    required: ['master', 'develop'],
    atLeast: [{ patterns: ['release-sprint-*', 'release-*'], count: 5 }],
  };
  const features = Array.from({ length: 10 }, (_, index) => at(`feature/f${index}`, 20 + index));
  const releases = Array.from({ length: 7 }, (_, index) =>
    at(`release-26.${10 + index}`, 3 + index),
  );
  const heads = [at('master', 1), at('develop', 2), ...releases, ...features];

  test('master, develop and the 5 newest releases always; the newest others fill up to 12', () => {
    const picked = pickRecentBranches(heads, rule).map((head) => head.name);
    expect(picked).toHaveLength(12);
    expect(picked).toContain('master');
    expect(picked).toContain('develop');
    expect(picked.filter((name) => name.startsWith('release-'))).toEqual([
      'release-26.16',
      'release-26.15',
      'release-26.14',
      'release-26.13',
      'release-26.12',
    ]);
    //? The 5 left go to the newest of the rest — features, newer than any release
    expect(picked.slice(0, 5)).toEqual([
      'feature/f9',
      'feature/f8',
      'feature/f7',
      'feature/f6',
      'feature/f5',
    ]);
  });

  test('newest first, and sprint releases count toward the release quota', () => {
    const picked = pickRecentBranches(
      [at('master', 1), at('develop', 2), at('release-sprint-26.14', 9), at('release-26.16', 5)],
      rule,
    ).map((head) => head.name);
    expect(picked).toEqual(['release-sprint-26.14', 'release-26.16', 'develop', 'master']);
  });

  test('fewer releases than asked: the filler is still capped at the limit', () => {
    const picked = pickRecentBranches([at('master', 1), at('develop', 2), ...features], rule);
    expect(picked).toHaveLength(12);
  });
});

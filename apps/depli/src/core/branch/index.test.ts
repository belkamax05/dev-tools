import { describe, expect, test } from 'bun:test';

import { matchesPatterns } from '../plugin';
import { orderBranches, resolveSelection } from '.';

describe('resolveSelection', () => {
  test('keeps a pick while the checkout stays on the branch it was made on', () => {
    const saved = { selected: 'release-26.16', pickedWhileOn: 'develop' };
    expect(resolveSelection(saved, 'develop')).toEqual({
      branch: 'release-26.16',
      selection: saved,
      reset: false,
    });
  });

  test('drops the pick and preselects the new branch after a checkout switch', () => {
    const result = resolveSelection(
      { selected: 'release-26.16', pickedWhileOn: 'develop' },
      'master',
    );
    expect(result).toEqual({
      branch: 'master',
      selection: { selected: 'master', pickedWhileOn: 'master' },
      reset: true,
    });
  });

  test('starts on the current branch with nothing saved', () => {
    expect(resolveSelection({}, 'develop').branch).toBe('develop');
    expect(resolveSelection({}, 'develop').reset).toBe(false);
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

describe('orderBranches', () => {
  const head = (name: string) => ({ name, sha: name });
  const local = [head('fix/mine'), head('develop'), head('wip/unpushed')];
  const watched = [head('master'), head('develop'), head('release-26.16')];
  const pushed = new Map(
    [...watched, head('fix/mine')].map((entry) => [
      entry.name,
      { ...entry, sha: `remote-${entry.name}` },
    ]),
  );

  test('the checked-out branch first, then the other local ones, then the watched — each once', () => {
    expect(
      orderBranches('fix/mine', local, watched, pushed).map((entry) => [entry.name, entry.section]),
    ).toEqual([
      ['fix/mine', 'current'],
      ['develop', 'local'],
      ['wip/unpushed', 'local'],
      ['master', 'remote'],
      ['release-26.16', 'remote'],
    ]);
  });

  test('marks only branches the provider does not have; prefers the provider entry', () => {
    const ordered = orderBranches('fix/mine', local, watched, pushed);
    expect(ordered.filter((entry) => entry.localOnly).map((entry) => entry.name)).toEqual([
      'wip/unpushed',
    ]);
    expect(ordered[0]?.sha).toBe('remote-fix/mine');
  });

  test('nothing is marked local-only while the provider has not been read', () => {
    expect(orderBranches('fix/mine', local, [], undefined).some((entry) => entry.localOnly)).toBe(
      false,
    );
  });
});

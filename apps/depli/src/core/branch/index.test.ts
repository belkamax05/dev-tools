import { describe, expect, test } from 'bun:test';

import { matchesPatterns } from '../plugin';
import { resolveSelection } from '.';

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

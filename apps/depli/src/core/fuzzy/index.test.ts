import { describe, expect, test } from 'bun:test';

import { planToCurl } from '../curl';
import { fuzzyFilter, fuzzyScore } from '.';

const BRANCHES = [
  'develop',
  'master',
  'release-26.15',
  'release-26.16',
  'release-sprint-26.14',
  'fix/dfs2-36962/issue4-multiple-console-errors-observed',
  'feat/dfs2-36977/fe-render-power-icons',
];

describe('fuzzyScore', () => {
  test('letters in order, not adjacent', () => {
    expect(fuzzyScore('release-26.16', 'r2616')).toBeDefined();
    expect(fuzzyScore('release-26.16', 'r6216')).toBeUndefined();
  });

  test('a plain substring beats a scattered match', () => {
    expect(fuzzyFilter(BRANCHES, '26.16', (name) => name)[0]).toBe('release-26.16');
  });

  test('a ticket number finds its branch', () => {
    expect(fuzzyFilter(BRANCHES, '36962', (name) => name)).toEqual([
      'fix/dfs2-36962/issue4-multiple-console-errors-observed',
    ]);
  });

  test('an empty query keeps everything in order', () => {
    expect(fuzzyFilter(BRANCHES, '  ', (name) => name)).toEqual(BRANCHES);
  });
});

describe('planToCurl', () => {
  test('auth by variable name, every param url-encoded, nothing sent', () => {
    const curl = planToCurl({
      target: 'deploy_frontend_only_ci',
      method: 'POST',
      url: 'https://ci.example.com/job/deploy/buildWithParameters',
      params: { FE_CODE_BRANCH: "it's/a-branch", FLAG: 'true' },
      shellAuth: '-u "$CI_USER:$CI_TOKEN"',
    });
    expect(curl).toBe(
      [
        'curl -X POST',
        '-u "$CI_USER:$CI_TOKEN"',
        `--data-urlencode 'FE_CODE_BRANCH=it'\\''s/a-branch'`,
        `--data-urlencode 'FLAG=true'`,
        `'https://ci.example.com/job/deploy/buildWithParameters'`,
      ].join(' \\\n  '),
    );
  });
});
